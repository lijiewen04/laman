const fileService = require("../services/fileService");
const { createResponse } = require("../middleware/auth");
const fs = require("fs");
const path = require("path");

// 文件上传
const uploadFile = async (req, res) => {
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
const downloadFile = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "文件ID不能为空"));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, "文件不存在"));
    }

    // 检查文件是否存在
    if (!fs.existsSync(fileRecord.filePath)) {
      return res.json(createResponse(4003, "文件不存在或已被删除"));
    }

    // 检查下载权限
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
const getFileList = async (req, res) => {
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
const getFilePreview = async (req, res) => {
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
const deleteFile = async (req, res) => {
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
const getFileTypes = async (req, res) => {
  try {
    const types = await fileService.getFileTypes();
    res.json(createResponse(0, "获取文件类型成功", types));
  } catch (error) {
    console.error("获取文件类型错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

// 授权访客下载
const authorizeDownload = async (req, res) => {
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

module.exports = {
  uploadFile,
  downloadFile,
  getFileList,
  getFilePreview,
  deleteFile,
  getFileTypes,
  authorizeDownload,
};
