import db from '../database/duckdb.js';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';
import userService from './userService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FileService {
  constructor() {
    this.uploadDir = path.join(__dirname, '../../uploads');
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
      fileType = '其他',
      description = '',
      metadata = {},
      patientId,
    } = fileData;

    // patientId 必填
    if (patientId === undefined || patientId === null || isNaN(Number(patientId))) {
      throw new Error('需要提供有效的 patientId');
    }

    const inserted = await db.get(
      `INSERT INTO files (
        filename, original_name, mime_type, size, file_path, file_type, description, metadata, uploaded_by, patient_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
        Number(patientId),
      ]
    );

    return await this.getFileById(inserted.id);
  }

  // 把行对象中的 BigInt 转为 Number（递归一层）
  normalizeRow(row) {
    // DB 层已经尽量把 BigInt/Date-like 转为原生数字（秒）。此处做安全处理：
    if (!row || typeof row !== 'object') return row;
    const out = Array.isArray(row) ? [] : {};
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v === 'bigint') {
        out[key] = Number(v);
      } else if (v instanceof Date) {
        out[key] = Math.floor(v.getTime() / 1000);
      } else if (
        v &&
        typeof v === 'object' &&
        (Object.prototype.hasOwnProperty.call(v, 'micros') || Object.prototype.hasOwnProperty.call(v, 'microseconds'))
      ) {
        try {
          const micros = v.micros !== undefined ? v.micros : v.microseconds;
          const microsNum = typeof micros === 'bigint' ? Number(micros) : Number(micros);
          out[key] = Math.floor(microsNum / 1_000_000);
        } catch (e) {
          out[key] = v;
        }
      } else if (v && typeof v === 'object') {
        out[key] = this.normalizeRow(v);
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
        f.metadata, f.uploaded_by as uploadedBy, f.patient_id as patientId,
        f.download_count as downloadCount, f.created_at as createdAt,
        u.username as uploadedByUsername, p.name as patientName
       FROM files f
       LEFT JOIN users u ON f.uploaded_by = u.id
       LEFT JOIN patients p ON f.patient_id = p.id
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
  async getFiles(filter = {}, page = 1, limit = 20, currentUser = null) {
    let whereClause = 'WHERE f.is_deleted = false';
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

    if (filter.patientId !== undefined) {
      whereClause += ` AND f.patient_id = ?`;
      params.push(Number(filter.patientId));
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
       LEFT JOIN patients p ON f.patient_id = p.id 
       ${whereClause}`,
      params
    );

    let files;
    const isVisitor = currentUser && (currentUser.userPermission === '访客' || currentUser.user_permission === '访客');
    if (isVisitor)
      files = await db.all(
        `SELECT
        f.id, f.filename, f.original_name as originalName, f.mime_type as mimeType,
        f.size, f.file_path as filePath, f.file_type as fileType, f.description, f.metadata,
        f.download_count as downloadCount, f.created_at as createdAt,
        f.uploaded_by as uploadedBy, f.patient_id as patientId, u.username as uploadedByUsername, p.name as patientName,
        EXISTS (
          SELECT 1
          FROM file_download_authorizations fda
          WHERE fda.user_id = 2
            AND fda.file_id = f.id
            AND fda.status = 'active'
            AND TO_TIMESTAMP(fda.expires_at) > CURRENT_TIMESTAMP
        ) AS hasPermission
        FROM files f
        LEFT JOIN users u ON f.uploaded_by = u.id
        LEFT JOIN patients p ON f.patient_id = p.id
        ${whereClause}
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
    else
      files = await db.all(
        `SELECT 
        f.id, f.filename, f.original_name as originalName, f.mime_type as mimeType,
        f.size, f.file_path as filePath, f.file_type as fileType, f.description, f.metadata,
        f.download_count as downloadCount, f.created_at as createdAt,
        f.uploaded_by as uploadedBy, f.patient_id as patientId, u.username as uploadedByUsername, p.name as patientName
          FROM files f
          LEFT JOIN users u ON f.uploaded_by = u.id
          LEFT JOIN patients p ON f.patient_id = p.id
          ${whereClause}
          ORDER BY f.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
    if (!isVisitor) {
      files = files.map((f) => ({ ...f, hasPermission: true }));
    }

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
    await db.run('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [id]);
  }

  // 删除文件（软删除）
  async deleteFile(id) {
    const result = await db.run('UPDATE files SET is_deleted = true WHERE id = ?', [id]);
    return result.changes > 0;
  }

  // 获取文件类型列表
  async getFileTypes() {
    const types = await db.all('SELECT DISTINCT file_type FROM files WHERE is_deleted = false ORDER BY file_type');
    return types.map((type) => type.file_type);
  }

  // 解析 CSV 文件
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });
  }

  // 更新文件记录的 metadata（合并已有 metadata）
  async updateFileMetadata(fileId, newMetadata = {}) {
    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('文件不存在');
    }

    let existing = {};
    if (file.metadata && typeof file.metadata === 'object') {
      existing = file.metadata;
    } else if (file.metadata && typeof file.metadata === 'string') {
      try {
        existing = JSON.parse(file.metadata);
      } catch (e) {
        existing = {};
      }
    }

    const merged = { ...existing, ...newMetadata };

    await db.run(`UPDATE files SET metadata = ? WHERE id = ?`, [JSON.stringify(merged), fileId]);

    return merged;
  }

  // 把标识符（表名）安全化，仅保留字母数字和下划线
  safeIdentifier(name) {
    return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
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
      throw new Error('文件不存在');
    }
    const filePath = fileRecord.filePath;
    const fileType = fileRecord.fileType;

    try {
      if (fileType === 'CSV') {
        // 直接从文件系统读取 CSV，不再使用 DuckDB
        const allData = await this.parseCSV(filePath);
        return {
          preview: allData.slice(0, limit),
          totalRows: allData.length,
          fileType: 'CSV',
          source: 'filesystem',
        };
      } else if (fileType === 'Excel') {
        const allData = await this.parseExcel(filePath);
        const firstSheet = Object.keys(allData)[0];
        return {
          preview: allData[firstSheet].slice(0, limit),
          totalRows: allData[firstSheet].length,
          fileType: 'Excel',
          sheetName: firstSheet,
          totalSheets: Object.keys(allData).length,
        };
      } else {
        return {
          preview: null,
          message: '该文件类型不支持预览',
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
    return ['超级管理员', '管理员', '用户'].includes(userPermission);
  }

  // 为访客授权下载：仅接受 userId（数字）作为目标用户标识
  async authorizeDownload(fileId, userId, expiresIn = 24) {
    if (userId === undefined || userId === null || isNaN(Number(userId))) {
      throw new Error('需要提供有效的 userId');
    }

    const id = Number(userId);
    const user = await userService.getUserById(id);

    if (!user) {
      throw new Error('用户不存在');
    }

    const perm = user.user_permission !== undefined ? user.user_permission : user.userPermission;
    if (perm !== '访客') {
      throw new Error('只能为访客用户授权下载');
    }

    // 计算过期时间（秒级时间戳）并存储整数
    const expiresAtDate = new Date();
    expiresAtDate.setHours(expiresAtDate.getHours() + parseInt(expiresIn));
    const expiresAtTs = Math.floor(expiresAtDate.getTime() / 1000);

    try {
      const result = await db.run(
        `INSERT INTO file_download_authorizations (file_id, user_id, expires_at)
         VALUES (?, ?, ?)`,
        [fileId, user.id, expiresAtTs]
      );

      return {
        success: result.changes > 0,
        username: user.username,
        fileId: fileId,
        expiresAt: expiresAtTs,
      };
    } catch (err) {
      // 如果是唯一约束冲突（已存在授权），则更新过期时间而不是抛错
      const msg = String(err && err.message ? err.message : err);
      if (/unique|duplicate|违反|UNIQUE|Duplicate/i.test(msg)) {
        const updateRes = await db.run(
          `UPDATE file_download_authorizations SET expires_at = ? WHERE file_id = ? AND user_id = ?`,
          [expiresAtTs, fileId, user.id]
        );

        return {
          success: updateRes.changes > 0,
          username: user.username,
          fileId: fileId,
          expiresAt: expiresAtTs,
          note: updateRes.changes > 0 ? '授权已存在，已更新过期时间' : '授权已存在但未更新',
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
      // 由于 expires_at 存为秒级整数，直接与当前 epoch 秒比较
      const authorization = await db.get(
        `SELECT id, expires_at, expires_at > CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT) as is_valid
         FROM file_download_authorizations 
         WHERE file_id = ? AND user_id = ?`,
        [fileId, userId]
      );

      // 未找到任何授权记录
      if (!authorization) {
        return { authorized: false, reason: '未授权' };
      }

      // 根据数据库返回的 is_valid 值判断是否仍然有效
      if (authorization.is_valid === true || authorization.is_valid === 1) {
        return { authorized: true };
      }

      // 找到了授权记录但已过期
      return { authorized: false, reason: '授权已过期' };
    } catch (err) {
      console.error('检查下载授权时出错:', err);
      // 出错时返回结构化结果，便于上层区分原因并展示友好提示
      return { authorized: false, reason: '检查授权失败' };
    }
  }

  // 访客提交下载申请
  async createDownloadRequest(fileId, userId, message = '') {
    // 基本校验
    if (!fileId) throw new Error('文件ID不能为空');
    if (!userId) throw new Error('用户ID不能为空');

    const file = await this.getFileById(fileId);
    if (!file) {
      throw new Error('文件不存在');
    }

    const user = await userService.getUserById(Number(userId));
    if (!user) {
      throw new Error('用户不存在');
    }

    const perm = user.user_permission !== undefined ? user.user_permission : user.userPermission;
    if (perm !== '访客') {
      // 非访客无需提交申请
      return { success: false, reason: 'not_needed' };
    }

    // 检查是否已有历史申请（按时间倒序取最新一条）
    const lastRecord = await db.get(
      `SELECT id, status, created_at FROM download_requests WHERE file_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [fileId, user.id]
    );

    if (lastRecord) {
      const status = lastRecord.status;

      if (status === 'pending') {
        return { success: false, reason: 'already_pending', requestId: lastRecord.id };
      }

      if (status === 'approved' && lastRecord.expires_at > Math.floor(Date.now() / 1000)) {
        return { success: false, reason: 'already_approved', requestId: lastRecord.id };
      }

      if (status === 'rejected') {
        // 计算距离上次拒绝时间是否小于 24 小时
        let createdAtMs = null;
        try {
          const ca = lastRecord.created_at;
          if (typeof ca === 'number') {
            // 如果看起来像毫秒（> 1e12），直接使用；否则按秒处理
            createdAtMs = ca > 1e12 ? ca : ca * 1000;
          } else {
            const d = new Date(ca);
            createdAtMs = isNaN(d.getTime()) ? null : d.getTime();
          }
        } catch (e) {
          createdAtMs = null;
        }

        if (createdAtMs) {
          const diffSeconds = (Date.now() - createdAtMs) / 1000;
          const oneDay = 24 * 3600;
          if (diffSeconds < oneDay) {
            return {
              success: false,
              reason: 'recently_rejected',
              retryAfterSeconds: Math.ceil(oneDay - diffSeconds),
              requestId: lastRecord.id,
            };
          }
        }
        // 若拒绝已经超过 24 小时，则允许再次提交（继续执行）
      }
    }

    // 插入申请记录，返回插入 id
    const inserted = await db.get(
      `INSERT INTO download_requests (file_id, user_id, username, message, status) VALUES (?, ?, ?, ?, 'pending') RETURNING id, created_at`,
      [fileId, user.id, user.username, message || '']
    );

    if (!inserted || !inserted.id) {
      return { success: false, reason: 'insert_failed' };
    }

    // 返回申请信息
    const requestRecord = await db.get(
      `SELECT id, file_id as fileId, user_id as userId, username, message, status, created_at as createdAt FROM download_requests WHERE id = ?`,
      [inserted.id]
    );

    return { success: true, request: this.normalizeRow(requestRecord) };
  }

  // 管理员处理访客的下载申请：批准或拒绝
  // action: 'approve' | 'reject'
  async processDownloadRequest(requestId, action, adminUserId, expiresIn = 24) {
    if (!requestId) throw new Error('请求ID不能为空');
    if (!action || (action !== 'approve' && action !== 'reject')) throw new Error('无效的 action');

    const reqRecord = await db.get(
      `SELECT id, file_id as fileId, user_id as userId, username, message, status FROM download_requests WHERE id = ?`,
      [requestId]
    );

    if (!reqRecord) {
      throw new Error('请求不存在');
    }

    // 新逻辑：
    // - 管理员可以批准 pending 或 rejected 的请求（即对已拒绝请求再次批准）
    // - 管理员不能拒绝已经被批准的请求（维持现状）
    // - 对于其他不允许的状态，保持已处理提示
    if (action === 'approve') {
      if (reqRecord.status === 'approved') {
        return { success: false, reason: 'already_approved', status: reqRecord.status };
      }
      // 允许 approve 对 pending 或 rejected
    } else if (action === 'reject') {
      if (reqRecord.status === 'approved') {
        return { success: false, reason: 'cannot_reject_approved', status: reqRecord.status };
      }
      if (reqRecord.status !== 'pending' && reqRecord.status !== 'rejected') {
        return { success: false, reason: 'already_processed', status: reqRecord.status };
      }
      // 允许 reject 对 pending 或 rejected（对已拒绝再次拒绝可当作已处理）
    }

    if (action === 'reject') {
      await db.run(`UPDATE download_requests SET status = 'rejected' WHERE id = ?`, [requestId]);
      return { success: true, action: 'rejected' };
    }

    // 批准：创建或更新授权记录（并设置 authorization.status = 'active'）
    // 复用 authorizeDownload 来创建/更新授权并获得 expiresAt
    const authResult = await this.authorizeDownload(reqRecord.fileId, reqRecord.userId, expiresIn);

    // 把 download_requests.status 标记为 approved
    await db.run(`UPDATE download_requests SET status = 'approved' WHERE id = ?`, [requestId]);

    // 如果 file_download_authorizations 表有 status 字段，则确保其为 'active'
    try {
      await db.run(`UPDATE file_download_authorizations SET status = 'active' WHERE file_id = ? AND user_id = ?`, [
        reqRecord.fileId,
        reqRecord.userId,
      ]);
    } catch (e) {
      // 忽略更新失败，让上层逻辑继续；主要是为了兼容不同 DB 状态
      console.error('更新授权状态失败:', e);
    }

    return { success: true, action: 'approved', authorization: authResult };
  }

  // 超级管理员获取下载申请列表（支持简单分页和按状态/文件筛选）
  async getDownloadRequests(filter = {}, page = 1, limit = 20) {
    // 支持按状态、fileId、userId、patientName、patientGroup 过滤
    let where = 'WHERE 1=1';
    const params = [];

    if (filter.status) {
      where += ` AND dr.status = ?`;
      params.push(filter.status);
    }

    if (filter.fileId !== undefined) {
      where += ` AND dr.file_id = ?`;
      params.push(Number(filter.fileId));
    }

    if (filter.userId !== undefined) {
      where += ` AND dr.user_id = ?`;
      params.push(Number(filter.userId));
    }

    if (filter.patientName) {
      where += ` AND p.name LIKE ?`;
      params.push(`%${filter.patientName}%`);
    }

    if (filter.patientId) {
      where += ` AND p."id" = ?`;
      params.push(Number(filter.patientId));
    }

    if (filter.patientGroup) {
      where += ` AND p."group" = ?`;
      params.push(filter.patientGroup);
    }

    if (filter.originalName) {
      where += ` AND LOWER(f.original_name) LIKE ?`;
      params.push(`%${String(filter.originalName).toLowerCase()}%`);
    }

    const offset = (page - 1) * limit;

    // 使用相同的 join 来计算总数，保证分页在加入 patient 过滤时仍然正确
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM download_requests dr
         LEFT JOIN files f ON dr.file_id = f.id
         LEFT JOIN patients p ON f.patient_id = p.id
         ${where}`,
      params
    );

    const rows = await db.all(
      `SELECT dr.id, dr.file_id as fileId, dr.user_id as userId, dr.username, dr.message, dr.status, dr.created_at as createdAt,
          f.original_name as originalName, f.filename as filename,
          p.id as patientId, p.serialNo as patientSerialNo, p.name as patientName, p."group" as patientGroup,
          (SELECT expires_at FROM file_download_authorizations fda WHERE fda.file_id = f.id AND fda.user_id = dr.user_id ORDER BY fda.id DESC LIMIT 1) as expiresAt
      FROM download_requests dr
      LEFT JOIN files f ON dr.file_id = f.id
      LEFT JOIN patients p ON f.patient_id = p.id
      ${where}
      ORDER BY dr.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const totalNum = Number(countResult && countResult.total ? countResult.total : 0);

    return {
      items: rows.map((r) => this.normalizeRow(r)),
      total: totalNum,
      page,
      limit,
      totalPages: Math.ceil(totalNum / limit),
    };
  }
}

export default new FileService();
