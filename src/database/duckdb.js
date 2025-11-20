const duckdb = require("duckdb");
const path = require("path");

class Database {
  constructor() {
    this.dbPath = process.env.DATABASE_PATH || "./database/auth.db";
    this.db = new duckdb.Database(this.dbPath);
    this.connection = this.db.connect();
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
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
         createdBy INTEGER REFERENCES users(id),
         createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
         uploaded_by INTEGER REFERENCES users(id),
         download_count INTEGER DEFAULT 0,
         is_deleted BOOLEAN DEFAULT false,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
`);
      //下载授权表
      await this.run(`
        CREATE TABLE IF NOT EXISTS file_download_authorizations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         file_id INTEGER REFERENCES files(id),
         user_id INTEGER REFERENCES users(id),
         expires_at TIMESTAMP NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         UNIQUE(file_id, user_id)
       )
     `);

      // 创建索引
      await this.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"
      );
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
        "CREATE INDEX IF NOT EXISTS idx_files_category ON files(category)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type)"
      );
      await this.run(
        "CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by)"
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

      console.log("数据库初始化完成");
    } catch (error) {
      console.error("数据库初始化失败:", error);
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.run(sql, params, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows && rows.length > 0 ? rows[0] : null);
        }
      });
    });
  }
}

// 创建单例实例
const database = new Database();
module.exports = database;
