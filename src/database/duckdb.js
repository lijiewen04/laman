import path from "path";
import fs from "fs";
import { DuckDBInstance } from "@duckdb/node-api";
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { generateStrongPassword } from "../controllers/authController";

// 使用 @duckdb/node-api 创建实例并连接

class Database {
  constructor(instance, connection, dbPath) {
    this.instance = instance;
    this.connection = connection;
    this.dbPath = dbPath;
    this.init();
  }

  async init() {
    try {
      // 创建用户表
      await this.run(`
          CREATE SEQUENCE IF NOT EXISTS user_id_seq START 1;

          CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY DEFAULT nextval('user_id_seq'),
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          user_permission VARCHAR(20) DEFAULT '访客',
          department VARCHAR(100),
          phone VARCHAR(20),
          is_active BOOLEAN DEFAULT true,
          -- 存为秒级整数时间戳
          created_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT),
          updated_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT)
        )
    `);

      // 创建病人表
      await this.run(`
        CREATE SEQUENCE IF NOT EXISTS patient_id_seq START 1;

        CREATE TABLE IF NOT EXISTS patients (
         id INTEGER PRIMARY KEY DEFAULT nextval('patient_id_seq'),
         abbr VARCHAR(50) NOT NULL,
         time BIGINT NOT NULL,
         name VARCHAR(100) NOT NULL,
         serialNo VARCHAR(100) UNIQUE NOT NULL,
         inpatientOutpatient VARCHAR(20) NOT NULL,
         "group" VARCHAR(100),
         gender VARCHAR(10),
         age INTEGER,
         caseNo VARCHAR(100),
         diagnosis TEXT,
         isTested BOOLEAN DEFAULT FALSE,
         tStage VARCHAR(10),
         nStage VARCHAR(10),
         mStage VARCHAR(10),
         stage VARCHAR(50),
         preTreatment VARCHAR(100),
         treatmentType VARCHAR(100),
         memo TEXT,
         createdBy INTEGER,
         createdAt BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT),
         updatedAt BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT)
       )
`);
      // 添加文件表
      await this.run(`
        CREATE SEQUENCE IF NOT EXISTS file_id_seq START 1;

        CREATE TABLE IF NOT EXISTS files (
         id INTEGER PRIMARY KEY DEFAULT nextval('file_id_seq'),
         filename VARCHAR(255) NOT NULL,
         original_name VARCHAR(255) NOT NULL,
         mime_type VARCHAR(100) NOT NULL,
         size INTEGER NOT NULL,
         file_path VARCHAR(500) NOT NULL,
         file_type VARCHAR(50) DEFAULT '其他',
         description TEXT,
         metadata TEXT, -- 存储JSON格式的元数据
         uploaded_by INTEGER,
         patient_id INTEGER NOT NULL,
         download_count INTEGER DEFAULT 0,
         is_deleted BOOLEAN DEFAULT false,
         created_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT),
         updated_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT)
        )
`);
      // 下载授权表（使用 sequence 而非 AUTOINCREMENT，兼容 DuckDB）
      await this.run(`
        CREATE SEQUENCE IF NOT EXISTS file_download_authorizations_id_seq START 1;

        CREATE TABLE IF NOT EXISTS file_download_authorizations (
         id INTEGER PRIMARY KEY DEFAULT nextval('file_download_authorizations_id_seq'),
         file_id INTEGER,
         user_id INTEGER,
         -- 存为秒级整数时间戳
         expires_at BIGINT NOT NULL,
         status VARCHAR(20) DEFAULT 'active',
         created_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT),
         UNIQUE(file_id, user_id)
       )
     `);

      // 创建索引
      await this.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)"
      );
      await this.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_serialNo ON patients(serialNo)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_patients_time ON patients(time)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_patients_isTested ON patients(isTested)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_patient_id ON files(patient_id)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_auth_file_user ON file_download_authorizations(file_id, user_id)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_auth_expires ON file_download_authorizations(expires_at)"
      );

      // 下载请求表（访客提交的下载申请）
      await this.run(`
        CREATE SEQUENCE IF NOT EXISTS download_requests_id_seq START 1;

        CREATE TABLE IF NOT EXISTS download_requests (
         id INTEGER PRIMARY KEY DEFAULT nextval('download_requests_id_seq'),
         file_id INTEGER,
         user_id INTEGER,
         username VARCHAR(100),
         message TEXT,
         status VARCHAR(20) DEFAULT 'pending',
         created_at BIGINT DEFAULT CAST(EXTRACT(epoch FROM CURRENT_TIMESTAMP) AS BIGINT)
        )
      `);

      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_download_requests_file_user ON download_requests(file_id, user_id)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_download_requests_status ON download_requests(status)"
      );

      // 如果用户表为空，自动创建一个默认的超级管理员
      try {
        const cntRow = await this.get(`SELECT COUNT(*) as cnt FROM users`);
        const cnt = cntRow && cntRow.cnt !== undefined ? (typeof cntRow.cnt === 'bigint' ? Number(cntRow.cnt) : cntRow.cnt) : 0;
        if (!cnt) {
          const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
          const plainPassword = generateStrongPassword(30);
          const hashed = await bcrypt.hash(plainPassword, 12);
          try {
            await this.run(
              `INSERT INTO users (username, password, department, user_permission, is_active) VALUES (?, ?, ?, ?, ?)`,
              [defaultUsername, hashed, '管理部门', '超级管理员', true]
            );
            console.log(`默认超级管理员已创建，用户名: ${defaultUsername}, 密码: ${plainPassword}`);
          } catch (e) {
            console.error('创建默认超级管理员失败:', e);
          }
        }
      } catch (e) {
        console.error('检查或创建默认管理员时出错:', e);
      }

      console.log("数据库初始化完成");
    } catch (error) {
      console.error("数据库初始化失败:", error);
    }
  }

  async run(sql, params = []) {
    const result = await this.connection.run(sql, params);
    // 尽可能提供与旧 API 兼容的 changes 字段
    const changes = result?.rowCount ?? result?.changes ?? 0;
    return { ...result, changes };
  }

  async all(sql, params = []) {
    const reader = await this.connection.runAndReadAll(sql, params);
    // 返回行对象数组，并把 BigInt 转为 Number（避免 JSON 序列化时报错）
    const rows = reader.getRowObjects ? reader.getRowObjects() : reader.getRows ? reader.getRows() : [];
    // 将可能的 BigInt/Date/Timestamp-like 字段转换为秒级 Number（浅层转换）
    return rows.map((row) => {
      const out = {};
      for (const key of Object.keys(row)) {
        const v = row[key];
        // BigInt -> Number
        if (typeof v === "bigint") {
          out[key] = Number(v);
          continue;
        }

        // DuckDB 驱动可能以对象形式返回 timestamp，例如 { micros: BigInt }
        if (v && typeof v === 'object' && (Object.prototype.hasOwnProperty.call(v, 'micros') || Object.prototype.hasOwnProperty.call(v, 'microseconds'))) {
          try {
            const micros = v.micros !== undefined ? v.micros : v.microseconds;
            const microsNum = typeof micros === 'bigint' ? Number(micros) : Number(micros);
            const secs = Math.floor(microsNum / 1_000_000);
            out[key] = secs;
            continue;
          } catch (e) {
            out[key] = v;
            continue;
          }
        }

        // Date -> seconds
        if (v instanceof Date) {
          out[key] = Math.floor(v.getTime() / 1000);
          continue;
        }

        // 其他类型保持原样（数字/字符串/布尔等）
        out[key] = v;
      }
      return out;
    });
  }

  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  // 优雅关闭：关闭 connection 和 instance（如果可用）
  async close() {
    try {
      if (this.connection && typeof this.connection.close === "function") {
        await this.connection.close();
      }
      if (this.instance && typeof this.instance.close === "function") {
        await this.instance.close();
      }
      console.log("DuckDB 连接已关闭");
    } catch (err) {
      console.error("关闭 DuckDB 时出错:", err);
      throw err;
    }
  }
}

// 创建单例实例
// 使用 top-level await 创建实例并导出单例
const dbPath = process.env.DATABASE_PATH || "./database/auth.db";
const dbPathResolved = path.resolve(dbPath);
const dbDir = path.dirname(dbPathResolved);
// 确保目录存在（避免打开数据库文件时因目录不存在导致失败）
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
let database;
try {
  const instance = await DuckDBInstance.create(dbPathResolved);
  const connection = await instance.connect();
  database = new Database(instance, connection, dbPath);
  console.log("DuckDB 实例已创建，路径:", dbPathResolved);
} catch (err) {
  console.error("初始化 DuckDB 时出错:", err);
  console.error(
    "请确保安装了 @duckdb/node-api 及对应的 node-bindings，运行 `pnpm install` 或 `pnpm rebuild @duckdb/node-bindings`。"
  );
  throw err;
}

export default database;

// 导出一个便捷方法以便外部优雅关闭数据库
export async function closeDatabase() {
  if (database && typeof database.close === "function") {
    return database.close();
  }
}
