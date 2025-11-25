import db from "../database/duckdb.js";
import bcrypt from "bcryptjs";

class UserService {
  // 创建用户
  async createUser(userData) {
    const {
      username,
      password,
      userPermission = "访客",
      department,
      phone,
    } = userData;

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 12);

    // 使用 RETURNING 获取插入的 id（DuckDB 支持 RETURNING）
    const inserted = await db.get(
      `INSERT INTO users (username, password, user_permission, department, phone)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [username, hashedPassword, userPermission, department, phone]
    );

    const user = await this.getUserById(inserted.id);
    return user;
  }

  // 根据ID获取用户
  async getUserById(id) {
    return await db.get(
      `SELECT id, username, user_permission as userPermission, department, phone, is_active, created_at, updated_at 
       FROM users WHERE id = ?`,
      [id]
    );
  }

  // 根据用户名获取用户（包含密码）
  async getUserByUsername(username) {
    return await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
  }

  // 检查用户名是否存在
  async checkUserExists(username) {
    const existingUser = await db.get(
      `SELECT id FROM users WHERE username = ?`,
      [username]
    );
    return existingUser !== null;
  }

  // 获取所有用户列表（符合 UserListItem 类型）
  async getAllUsers() {
    return await db.all(
      `SELECT id, username, user_permission as userPermission, department, phone 
       FROM users WHERE is_active = true 
       ORDER BY created_at DESC`
    );
  }

  // 获取用户列表，支持筛选与分页（推荐使用）
  async getUsers(filter = {}, page = 1, limit = 20) {
    // 默认只返回激活用户；如果传入 filter.isActive 则使用其值
    let whereClause = "WHERE 1=1";
    const params = [];

    if (filter.isActive === undefined) {
      whereClause += ` AND is_active = true`;
    } else {
      whereClause += ` AND is_active = ?`;
      params.push(filter.isActive ? 1 : 0);
    }

    if (filter.username) {
      whereClause += ` AND username LIKE ?`;
      params.push(`%${filter.username}%`);
    }

    if (filter.department) {
      whereClause += ` AND department LIKE ?`;
      params.push(`%${filter.department}%`);
    }

    if (filter.userPermission) {
      whereClause += ` AND user_permission = ?`;
      params.push(filter.userPermission);
    }

    if (filter.phone) {
      whereClause += ` AND phone LIKE ?`;
      params.push(`%${filter.phone}%`);
    }

    if (filter.createdAtStart) {
      whereClause += ` AND created_at >= ?`;
      params.push(filter.createdAtStart);
    }

    if (filter.createdAtEnd) {
      whereClause += ` AND created_at <= ?`;
      params.push(filter.createdAtEnd);
    }

    const offset = (page - 1) * limit;

    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      params
    );
    const total = typeof countResult.total === "bigint" ? Number(countResult.total) : countResult.total;

    const users = await db.all(
      `SELECT id, username, user_permission as userPermission, department, phone
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 更新用户信息
  async updateUser(id, updateData) {
    const { username, userPermission, department, phone } = updateData;

    // 仅更新传入的字段，避免把未传入的字段错误地设为 NULL 或触发约束
    const sets = [];
    const params = [];

    if (username !== undefined) {
      sets.push("username = ?");
      params.push(username);
    }
    if (userPermission !== undefined) {
      sets.push("user_permission = ?");
      params.push(userPermission);
    }
    if (department !== undefined) {
      sets.push("department = ?");
      params.push(department);
    }
    if (phone !== undefined) {
      sets.push("phone = ?");
      params.push(phone);
    }

    // 如果没有任何要更新的字段，直接返回当前用户
    if (sets.length === 0) {
      return await this.getUserById(id);
    }

    const sql = `UPDATE users SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params.push(id);

    try {
      console.log("Executing SQL:", sql, "params:", params);
      await db.run(sql, params);
    } catch (err) {
      console.error("updateUser SQL error:", err, "sql:", sql, "params:", params);
      // 抛出带有更多上下文的错误，控制器会在开发环境中返回给客户端
      const e = new Error(`updateUser failed: ${err.message}`);
      e.stack = err.stack;
      e.sql = sql;
      e.params = params;
      throw e;
    }

    return await this.getUserById(id);
  }

  // 更新用户权限
  async updateUserPermission(username, userPermission) {
    await db.run(
      `UPDATE users SET user_permission = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
      [userPermission, username]
    );

    return await this.getUserByUsername(username);
  }

  // 更新用户权限（按 id）
  async updateUserPermissionById(id, userPermission) {
    await db.run(
      `UPDATE users SET user_permission = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [userPermission, id]
    );

    return await this.getUserById(id);
  }

  // 验证密码
  async validatePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  // 注意：不再使用 last_insert_rowid()，INSERT ... RETURNING 在需要时返回 id

  // 删除用户（软删除）
  async deleteUser(id) {
    const result = await db.run(
      "UPDATE users SET is_active = false WHERE id = ?",
      [id]
    );
    return result.changes > 0;
  }

  // 按 id 设置用户密码（用于管理员重置密码）
  async setPasswordById(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await db.run(
      `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashedPassword, id]
    );
    return await this.getUserById(id);
  }

  // 统计用户在其他表中的引用，返回各表的计数
  async countUserReferences(id) {
    const refs = {};

    // files.uploaded_by
    const f = await db.get(`SELECT COUNT(*) as cnt FROM files WHERE uploaded_by = ?`, [id]);
    refs.files = typeof f.cnt === 'bigint' ? Number(f.cnt) : (f.cnt || 0);

    // patients.createdBy
    const p = await db.get(`SELECT COUNT(*) as cnt FROM patients WHERE createdBy = ?`, [id]);
    refs.patients = typeof p.cnt === 'bigint' ? Number(p.cnt) : (p.cnt || 0);

    // file_download_authorizations.user_id
    const a = await db.get(`SELECT COUNT(*) as cnt FROM file_download_authorizations WHERE user_id = ?`, [id]);
    refs.file_download_authorizations = typeof a.cnt === 'bigint' ? Number(a.cnt) : (a.cnt || 0);

    return refs;
  }
}

export default new UserService();
