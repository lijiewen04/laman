import fileService from "../services/fileService.js";
import { createResponse } from "../middleware/auth.js";
import fs from "fs";
import path from "path";
import db from "../database/duckdb.js";

// 文件上传
export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.json(createResponse(4001, "请选择要上传的文件"));
    }

    const { fileType = "其他", description = "" } = req.body;
    const uploadedBy = req.user.id;

    // 根据文件扩展名确定文件类型
    const detectedFileType = detectFileType(
      req.file.originalname,
      req.file.mimetype
    );
    const finalFileType = fileType !== "其他" ? fileType : detectedFileType;

    // 提取文件元数据
    const metadata = await extractFileMetadata(req.file, finalFileType);

    const fileRecord = await fileService.createFileRecord(
      {
        ...req.file,
        fileType: finalFileType,
        description,
        metadata,
      },
      uploadedBy
    );

    // 如果是 CSV 文件，尝试把 CSV 导入 DuckDB，表名使用 file_<id>
    let importedTable = null;
    try {
      if (finalFileType === "CSV") {
        const tableName = `csv_file_${fileRecord.id}`;
        const importResult = await fileService.importCSVToDuckDB(
          fileRecord.filePath,
          tableName
        );
        importedTable = importResult.tableName || tableName;
      }
    } catch (importErr) {
      console.error("导入 CSV 到 DuckDB 失败:", importErr);
      // 不阻塞文件上传；记录失败信息到 metadata 中
      metadata.importError = importErr.message || String(importErr);
    }

    // 如果导入成功并有表名，持久化到文件 metadata 中
    try {
      if (importedTable) {
        await fileService.updateFileMetadata(fileRecord.id, { tableName: importedTable });
      }
    } catch (metaErr) {
      console.error("更新文件 metadata 失败:", metaErr);
    }

    // 返回文件信息
    const fileInfo = {
      id: fileRecord.id,
      filename: fileRecord.filename,
      originalName: fileRecord.originalName,
      mimeType: fileRecord.mimeType,
      size: fileRecord.size,
      fileType: fileRecord.fileType,
      description: fileRecord.description,
      metadata: fileRecord.metadata,
      downloadCount: fileRecord.downloadCount,
      createdAt: fileRecord.createdAt,
      uploadedBy: fileRecord.uploadedByUsername,
      importedTable,
    };

    res.json(createResponse(0, "文件上传成功", fileInfo));
  } catch (error) {
    console.error("文件上传错误:", error);

    // 如果上传失败，删除已保存的文件
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error("删除文件失败:", unlinkError);
      }
    }

    res.json(createResponse(5001, "文件上传失败"));
  }
};

// 文件下载
export const downloadFile = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "文件ID不能为空"));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, "文件不存在"));
    }

    // 权限检查（先判断权限，若无权限直接返回）
    let hasPermission = fileService.canUserDownload(req.user.userPermission);

    // 如果是访客，检查是否有下载授权
    if (!hasPermission && req.user.userPermission === "访客") {
      hasPermission = await fileService.checkDownloadAuthorization(
        id,
        req.user.id
      );
    }

    if (!hasPermission) {
      return res.json(
        createResponse(4004, "没有下载权限，请联系超级管理员授权")
      );
    }

    // 对于 CSV，如果已经导入到 DuckDB，则从数据库导出 CSV
    if (fileRecord.fileType === "CSV" && fileRecord.metadata && fileRecord.metadata.tableName) {
      try {
        const safeName = fileService.safeIdentifier(fileRecord.metadata.tableName);
        const tableRows = await db.all(`SELECT * FROM ${safeName}`);

        // 将行对象数组转换为 CSV 文本（简单实现，注意大文件内存占用）
        const toCsv = (rows) => {
          if (!rows || rows.length === 0) return "";
          const keys = Object.keys(rows[0]);
          const escape = (v) => {
            if (v === null || v === undefined) return "";
            const s = String(v);
            if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          };
          const header = keys.join(",");
          const lines = rows.map(r => keys.map(k => escape(typeof r[k] === 'bigint' ? Number(r[k]) : r[k])).join(","));
          return [header, ...lines].join("\n");
        };

        const csvContent = toCsv(tableRows.map(r => fileService.normalizeRow(r)));

        // 增加下载次数
        await fileService.incrementDownloadCount(id);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(fileRecord.originalName)}"`
        );
        res.setHeader("Content-Length", Buffer.byteLength(csvContent));
        return res.send(csvContent);
      } catch (err) {
        console.error("从 DuckDB 导出 CSV 失败:", err);
        // 回退到文件系统方式
      }
    }

    if (!fs.existsSync(fileRecord.filePath)) {
      return res.json(createResponse(4003, "文件不存在或已被删除"));
    }

    if (!hasPermission) {
      return res.json(
        createResponse(4004, "没有下载权限，请联系超级管理员授权")
      );
    }

    // 增加下载次数
    await fileService.incrementDownloadCount(id);

    // 设置下载头信息
    res.setHeader("Content-Type", fileRecord.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileRecord.originalName)}"`
    );
    res.setHeader("Content-Length", fileRecord.size);

    // 发送文件
    const fileStream = fs.createReadStream(fileRecord.filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error("文件下载错误:", error);
    res.json(createResponse(5001, "文件下载失败"));
  }
};

// 获取文件列表
export const getFileList = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      fileType,
      uploadedBy,
      filename,
      originalName,
    } = req.body;

    const filter = {};
    if (fileType) filter.fileType = fileType;
    if (uploadedBy) filter.uploadedBy = uploadedBy;
    if (filename) filter.filename = filename;
    if (originalName) filter.originalName = originalName;

    const result = await fileService.getFiles(
      filter,
      parseInt(page),
      parseInt(limit)
    );

    res.json(
      createResponse(0, "获取文件列表成功", {
        files: result.files,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      })
    );
  } catch (error) {
    console.error("获取文件列表错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

// 获取文件预览
export const getFilePreview = async (req, res) => {
  try {
    const { id, limit = 10 } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "文件ID不能为空"));
    }

    const preview = await fileService.getFilePreview(id, parseInt(limit));

    res.json(createResponse(0, "获取文件预览成功", preview));
  } catch (error) {
    console.error("获取文件预览错误:", error);
    res.json(createResponse(5001, error.message));
  }
};

// 删除文件
export const deleteFile = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "文件ID不能为空"));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, "文件不存在"));
    }

    // 只有超级管理员可以删除文件
    const deleted = await fileService.deleteFile(id);

    if (deleted) {
      // 物理删除文件
      try {
        if (fs.existsSync(fileRecord.filePath)) {
          fs.unlinkSync(fileRecord.filePath);
        }
      } catch (unlinkError) {
        console.error("物理删除文件失败:", unlinkError);
      }

      res.json(createResponse(0, "文件删除成功"));
    } else {
      res.json(createResponse(4005, "删除文件失败"));
    }
  } catch (error) {
    console.error("删除文件错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

// 获取文件类型列表
export const getFileTypes = async (req, res) => {
  try {
    const types = await fileService.getFileTypes();
    res.json(createResponse(0, "获取文件类型成功", types));
  } catch (error) {
    console.error("获取文件类型错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

// 授权访客下载
export const authorizeDownload = async (req, res) => {
  try {
    const { fileId, username, expiresIn = 24 } = req.body;

    if (!fileId || !username) {
      return res.json(createResponse(4001, "文件ID和用户名不能为空"));
    }

    const result = await fileService.authorizeDownload(
      fileId,
      username,
      expiresIn
    );

    if (result.success) {
      res.json(
        createResponse(0, "下载授权成功", {
          username: result.username,
          fileId: result.fileId,
          expiresAt: result.expiresAt,
        })
      );
    } else {
      res.json(createResponse(4008, "下载授权失败"));
    }
  } catch (error) {
    console.error("下载授权错误:", error);
    res.json(createResponse(5001, error.message));
  }
};

// 辅助函数：检测文件类型
function detectFileType(originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();

  const typeMap = {
    ".csv": "CSV",
    ".xls": "Excel",
    ".xlsx": "Excel",
    ".pdf": "PDF",
    ".doc": "Word",
    ".docx": "Word",
    ".txt": "文本",
    ".jpg": "图片",
    ".jpeg": "图片",
    ".png": "图片",
    ".gif": "图片",
  };

  return typeMap[ext] || "其他";
}

// 辅助函数：提取文件元数据
async function extractFileMetadata(file, fileType) {
  const metadata = {
    originalName: file.originalname,
    uploadTime: new Date().toISOString(),
    fileType: fileType,
  };

  try {
    if (fileType === "CSV") {
      const preview = await fileService.parseCSV(file.path);
      metadata.rowCount = preview.length;
      if (preview.length > 0) {
        metadata.columns = Object.keys(preview[0]);
      }
    } else if (fileType === "Excel") {
      const preview = await fileService.parseExcel(file.path);
      const firstSheet = Object.keys(preview)[0];
      metadata.sheetCount = Object.keys(preview).length;
      metadata.sheets = Object.keys(preview);
      if (preview[firstSheet].length > 0) {
        metadata.columns = Object.keys(preview[firstSheet][0]);
      }
    }
  } catch (error) {
    console.error("提取文件元数据失败:", error);
  }

  return metadata;
}

// functions are exported inline above
