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

  // 把行对象中的 BigInt 转为 Number（递归一层）
  normalizeRow(row) {
    if (!row || typeof row !== "object") return row;
    const out = Array.isArray(row) ? [] : {};
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v === "bigint") {
        out[key] = Number(v);
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        // DuckDB 的 TIMESTAMP 可能会被驱动封装为对象，例如 { micros: BigInt } 或 { micros: number }
        // 把这样的 timestamp 转为 ISO 字符串，便于前端使用和 JSON 序列化
        if (Object.prototype.hasOwnProperty.call(v, "micros")) {
          try {
            const micros = v.microseconds !== undefined ? v.microseconds : v.micros;
            const ms = typeof micros === "bigint" ? Number(micros) / 1000 : Number(micros) / 1000;
            const d = new Date(ms);
            out[key] = d.toISOString();
          } catch (e) {
            out[key] = this.normalizeRow(v);
          }
        } else {
          out[key] = this.normalizeRow(v);
        }
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  // 根据ID获取文件记录
  async getFileById(id) {
    const row = await db.get(
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

    if (!row) return null;
    const normalized = this.normalizeRow(row);
    if (normalized.metadata) {
      try {
        normalized.metadata = JSON.parse(normalized.metadata);
      } catch (e) {
        // keep as string if parse fails
      }
    }
    return normalized;
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

    if (filter.uploadedById !== undefined) {
      whereClause += ` AND f.uploaded_by = ?`;
      params.push(Number(filter.uploadedById));
    }

    if (filter.filename) {
      whereClause += ` AND f.filename LIKE ?`;
      params.push(`%${filter.filename}%`);
    }

    if (filter.originalName) {
      whereClause += ` AND f.original_name LIKE ?`;
      params.push(`%${filter.originalName}%`);
    }

    if (filter.mimeType) {
      whereClause += ` AND f.mime_type = ?`;
      params.push(filter.mimeType);
    }

    if (filter.minSize !== undefined) {
      whereClause += ` AND f.size >= ?`;
      params.push(Number(filter.minSize));
    }

    if (filter.maxSize !== undefined) {
      whereClause += ` AND f.size <= ?`;
      params.push(Number(filter.maxSize));
    }

    if (filter.description) {
      whereClause += ` AND f.description LIKE ?`;
      params.push(`%${filter.description}%`);
    }

    if (filter.createdAtStart) {
      whereClause += ` AND f.created_at >= ?`;
      params.push(filter.createdAtStart);
    }

    if (filter.createdAtEnd) {
      whereClause += ` AND f.created_at <= ?`;
      params.push(filter.createdAtEnd);
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
    let files = await db.all(
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
    // 规范化 BigInt，并解析 metadata JSON
    files = files.map((file) => {
      const normalized = this.normalizeRow(file);
      if (normalized.metadata) {
        try {
          normalized.metadata = JSON.parse(normalized.metadata);
        } catch (e) {
          // keep as string
        }
      }
      return normalized;
    });

    const totalNum = Number(countResult && countResult.total ? countResult.total : 0);

    return {
      files,
      total: totalNum,
      page,
      limit,
      totalPages: Math.ceil(totalNum / limit),
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

  // 将 CSV 导入到 DuckDB，tableName 会被安全化为只包含字母数字下划线
  async importCSVToDuckDB(filePath, tableName) {
    try {
      if (!filePath || !tableName) {
        throw new Error("需要提供 filePath 和 tableName");
      }

      // 安全化表名
      const safeName = String(tableName).replace(/[^a-zA-Z0-9_]/g, "_");

      // 先删除已存在的同名表（谨慎操作）
      await db.run(`DROP TABLE IF EXISTS ${safeName}`);

      // 使用 DuckDB 的 read_csv_auto 自动推断结构并创建表
      // 使用参数绑定来传入文件路径以避免注入风险
      const sql = `CREATE TABLE ${safeName} AS SELECT * FROM read_csv_auto(?)`;
      await db.run(sql, [filePath]);

      return { tableName: safeName };
    } catch (error) {
      console.error("将 CSV 导入 DuckDB 失败:", error);
      throw error;
    }
  }

  // 更新文件记录的 metadata（合并已有 metadata）
  async updateFileMetadata(fileId, newMetadata = {}) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error("文件不存在");
    }

    let existing = {};
    if (file.metadata && typeof file.metadata === "object") {
      existing = file.metadata;
    } else if (file.metadata && typeof file.metadata === "string") {
      try {
        existing = JSON.parse(file.metadata);
      } catch (e) {
        existing = {};
      }
    }

    const merged = { ...existing, ...newMetadata };

    await db.run(
      `UPDATE files SET metadata = ? WHERE id = ?`,
      [JSON.stringify(merged), fileId]
    );

    return merged;
  }

  // 把标识符（表名）安全化，仅保留字母数字和下划线
  safeIdentifier(name) {
    return String(name).replace(/[^a-zA-Z0-9_]/g, "_");
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
        // 优先从 DuckDB 读取，如果 metadata 中存在 tableName
        const metadata = fileRecord.metadata || {};
        if (metadata.tableName) {
          const safeName = this.safeIdentifier(metadata.tableName);
          const rows = await db.all(`SELECT * FROM ${safeName} LIMIT ?`, [limit]);
          const countRow = await db.get(`SELECT COUNT(*) as total FROM ${safeName}`);
          const totalRows = countRow && countRow.total ? Number(countRow.total) : 0;
          const normalized = rows.map((r) => this.normalizeRow(r));
          return {
            preview: normalized,
            totalRows,
            fileType: "CSV",
            source: "duckdb",
          };
        }

        // 回退到读取文件系统中的 CSV
        const allData = await this.parseCSV(filePath);
        return {
          preview: allData.slice(0, limit),
          totalRows: allData.length,
          fileType: "CSV",
          source: "filesystem",
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
    // 新增角色 "用户"，该角色位于访客和管理员之间，具备直接下载权限
    return ["超级管理员", "管理员", "用户"].includes(userPermission);
  }

  // 为访客授权下载：仅接受 userId（数字）作为目标用户标识
  async authorizeDownload(fileId, userId, expiresIn = 24) {
    if (userId === undefined || userId === null || isNaN(Number(userId))) {
      throw new Error("需要提供有效的 userId");
    }

    const id = Number(userId);
    const user = await userService.getUserById(id);

    if (!user) {
      throw new Error("用户不存在");
    }

    const perm = user.user_permission !== undefined ? user.user_permission : user.userPermission;
    if (perm !== "访客") {
      throw new Error("只能为访客用户授权下载");
    }

    // 计算过期时间（Date 对象，用于返回给客户端的 ISO 字符串）
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(expiresIn));

    // DuckDB 在 CAST ISO 带 'Z' 的字符串到 TIMESTAMP 时可能会忽略时区，
    // 导致比较 CURRENT_TIMESTAMP 失败（表现为短期授权立即过期）。
    // 为了兼容，存储到数据库的 expires_at 使用本地时间的不带时区格式：
    // "YYYY-MM-DD HH:MM:SS"，以便 CAST(expires_at AS TIMESTAMP) 与 CURRENT_TIMESTAMP 正常比较。
    const pad = (n) => String(n).padStart(2, "0");
    const localY = expiresAt.getFullYear();
    const localM = pad(expiresAt.getMonth() + 1);
    const localD = pad(expiresAt.getDate());
    const localH = pad(expiresAt.getHours());
    const localMin = pad(expiresAt.getMinutes());
    const localS = pad(expiresAt.getSeconds());
    const expiresAtLocalString = `${localY}-${localM}-${localD} ${localH}:${localMin}:${localS}`;

    try {
      const result = await db.run(
        `INSERT INTO file_download_authorizations (file_id, user_id, expires_at)
         VALUES (?, ?, ?)`,
        [fileId, user.id, expiresAtLocalString]
      );

      return {
        success: result.changes > 0,
        username: user.username,
        fileId: fileId,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      // 如果是唯一约束冲突（已存在授权），则更新过期时间而不是抛错
      const msg = String(err && err.message ? err.message : err);
      if (/unique|duplicate|违反|UNIQUE|Duplicate/i.test(msg)) {
        const updateRes = await db.run(
          `UPDATE file_download_authorizations SET expires_at = ? WHERE file_id = ? AND user_id = ?`,
          [expiresAtLocalString, fileId, user.id]
        );

        return {
          success: updateRes.changes > 0,
          username: user.username,
          fileId: fileId,
          expiresAt: expiresAt.toISOString(),
          note: updateRes.changes > 0 ? "授权已存在，已更新过期时间" : "授权已存在但未更新",
        };
      }

      // 其他错误继续抛出，以便上层记录
      throw err;
    }
  }

  // 检查访客下载授权
  async checkDownloadAuthorization(fileId, userId) {
    try {
      // 查询授权并判断是否仍然有效（is_valid 字段为布尔或 0/1）
      const authorization = await db.get(
        `SELECT id, expires_at, CAST(expires_at AS TIMESTAMP) > CURRENT_TIMESTAMP as is_valid
         FROM file_download_authorizations 
         WHERE file_id = ? AND user_id = ?`,
        [fileId, userId]
      );

      // 未找到任何授权记录
      if (!authorization) {
        return { authorized: false, reason: "未授权" };
      }

      // 根据数据库返回的 is_valid 值判断是否仍然有效
      if (authorization.is_valid === true || authorization.is_valid === 1) {
        return { authorized: true };
      }

      // 找到了授权记录但已过期
      return { authorized: false, reason: "授权已过期" };
    } catch (err) {
      console.error("检查下载授权时出错:", err);
      // 出错时返回结构化结果，便于上层区分原因并展示友好提示
      return { authorized: false, reason: "检查授权失败" };
    }
  }
}

export default new FileService();
