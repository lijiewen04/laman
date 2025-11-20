import db from "../database/duckdb.js";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import xlsx from "xlsx";
import { fileURLToPath } from "url";
import userService from "./userService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FileService {
  constructor() {
    this.uploadDir = path.join(__dirname, "../../uploads");
    this.ensureUploadDir();
  }

  // 确保上传目录存在
  ensureUploadDir() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // 创建文件记录
  async createFileRecord(fileData, uploadedBy) {
    const {
      filename,
      originalname,
      mimetype,
      size,
      path: filePath,
      fileType = "其他",
      description = "",
      metadata = {},
    } = fileData;

    const inserted = await db.get(
      `INSERT INTO files (
        filename, original_name, mime_type, size, file_path, file_type, description, metadata, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        filename,
        originalname,
        mimetype,
        size,
        filePath,
        fileType,
        description,
        JSON.stringify(metadata),
        uploadedBy,
      ]
    );

    return await this.getFileById(inserted.id);
  }

  // 根据ID获取文件记录
  async getFileById(id) {
    return await db.get(
      `SELECT 
        f.id, f.filename, f.original_name as originalName, f.mime_type as mimeType,
        f.size, f.file_path as filePath, f.file_type as fileType, f.description, 
        f.metadata, f.uploaded_by as uploadedBy,
        f.download_count as downloadCount, f.created_at as createdAt,
        u.username as uploadedByUsername
       FROM files f
       LEFT JOIN users u ON f.uploaded_by = u.id
       WHERE f.id = ? AND f.is_deleted = false`,
      [id]
    );
  }

  // 获取文件列表
  async getFiles(filter = {}, page = 1, limit = 20) {
    let whereClause = "WHERE f.is_deleted = false";
    const params = [];

    // 构建筛选条件
    if (filter.fileType) {
      whereClause += ` AND f.file_type = ?`;
      params.push(filter.fileType);
    }

    if (filter.uploadedBy) {
      whereClause += ` AND u.username LIKE ?`;
      params.push(`%${filter.uploadedBy}%`);
    }

    if (filter.filename) {
      whereClause += ` AND f.filename LIKE ?`;
      params.push(`%${filter.filename}%`);
    }

    if (filter.originalName) {
      whereClause += ` AND f.original_name LIKE ?`;
      params.push(`%${filter.originalName}%`);
    }

    // 计算分页
    const offset = (page - 1) * limit;

    // 获取总数
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM files f 
       LEFT JOIN users u ON f.uploaded_by = u.id 
       ${whereClause}`,
      params
    );

    // 获取数据
    const files = await db.all(
      `SELECT 
        f.id, f.filename, f.original_name as originalName, f.mime_type as mimeType,
        f.size, f.file_type as fileType, f.description, f.metadata,
        f.download_count as downloadCount, f.created_at as createdAt, 
        u.username as uploadedByUsername
       FROM files f
       LEFT JOIN users u ON f.uploaded_by = u.id
       ${whereClause}
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // 解析 metadata JSON
    files.forEach((file) => {
      if (file.metadata) {
        file.metadata = JSON.parse(file.metadata);
      }
    });

    return {
      files,
      total: countResult.total,
      page,
      limit,
      totalPages: Math.ceil(countResult.total / limit),
    };
  }

  // 增加下载次数
  async incrementDownloadCount(id) {
    await db.run(
      "UPDATE files SET download_count = download_count + 1 WHERE id = ?",
      [id]
    );
  }

  // 删除文件（软删除）
  async deleteFile(id) {
    const result = await db.run(
      "UPDATE files SET is_deleted = true WHERE id = ?",
      [id]
    );
    return result.changes > 0;
  }

  // 获取文件类型列表
  async getFileTypes() {
    const types = await db.all(
      "SELECT DISTINCT file_type FROM files WHERE is_deleted = false ORDER BY file_type"
    );
    return types.map((type) => type.file_type);
  }

  // 解析 CSV 文件
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => resolve(results))
        .on("error", (error) => reject(error));
    });
  }

  // 解析 Excel 文件
  async parseExcel(filePath) {
    try {
      const workbook = xlsx.readFile(filePath);
      const result = {};

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        result[sheetName] = xlsx.utils.sheet_to_json(worksheet);
      });

      return result;
    } catch (error) {
      throw new Error(`Excel 文件解析失败: ${error.message}`);
    }
  }

  // 获取文件预览（前几行数据）
  async getFilePreview(fileId, limit = 10) {
    const fileRecord = await this.getFileById(fileId);
    if (!fileRecord) {
      throw new Error("文件不存在");
    }

    const filePath = fileRecord.filePath;
    const fileType = fileRecord.fileType;

    try {
      if (fileType === "CSV") {
        const allData = await this.parseCSV(filePath);
        return {
          preview: allData.slice(0, limit),
          totalRows: allData.length,
          fileType: "CSV",
        };
      } else if (fileType === "Excel") {
        const allData = await this.parseExcel(filePath);
        const firstSheet = Object.keys(allData)[0];
        return {
          preview: allData[firstSheet].slice(0, limit),
          totalRows: allData[firstSheet].length,
          fileType: "Excel",
          sheetName: firstSheet,
          totalSheets: Object.keys(allData).length,
        };
      } else {
        return {
          preview: null,
          message: "该文件类型不支持预览",
        };
      }
    } catch (error) {
      throw new Error(`文件预览失败: ${error.message}`);
    }
  }

  // 不再使用 last_insert_rowid(); 使用 INSERT ... RETURNING 获取插入 id

  // 检查用户是否有下载权限
  canUserDownload(userPermission) {
    // 超级管理员和管理员可以直接下载
    return ["超级管理员", "管理员"].includes(userPermission);
  }

  // 为访客授权下载
  async authorizeDownload(fileId, username, expiresIn = 24) {
    const user = await userService.getUserByUsername(username);

    if (!user) {
      throw new Error("用户不存在");
    }

    if (user.userPermission !== "访客") {
      throw new Error("只能为访客用户授权下载");
    }

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(expiresIn));

    const result = await db.run(
      `INSERT INTO file_download_authorizations (file_id, user_id, expires_at)
       VALUES (?, ?, ?)`,
      [fileId, user.id, expiresAt]
    );

    return {
      success: result.changes > 0,
      username: user.username,
      fileId: fileId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // 检查访客下载授权
  async checkDownloadAuthorization(fileId, userId) {
    const authorization = await db.get(
      `SELECT id FROM file_download_authorizations 
       WHERE file_id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP`,
      [fileId, userId]
    );

    return authorization !== null;
  }
}

export default new FileService();
