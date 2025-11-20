const db = require("../database/duckdb");
const bcrypt = require("bcryptjs");

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

    const result = await db.run(
      `INSERT INTO users (username, password, user_permission, department, phone) 
       VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, userPermission, department, phone]
    );

    // 获取新创建的用户
    const user = await this.getUserById(this.getLastInsertRowid());
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
      `SELECT username, user_permission as userPermission, department, phone 
       FROM users WHERE is_active = true 
       ORDER BY created_at DESC`
    );
  }

  // 更新用户信息
  async updateUser(id, updateData) {
    const { username, userPermission, department, phone } = updateData;

    await db.run(
      `UPDATE users SET username = ?, user_permission = ?, department = ?, phone = ?, 
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [username, userPermission, department, phone, id]
    );

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

  // 验证密码
  async validatePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  // 获取最后插入的行ID
  async getLastInsertRowid() {
    const result = await db.get("SELECT last_insert_rowid() as id");
    return result.id;
  }

  // 删除用户（软删除）
  async deleteUser(id) {
    const result = await db.run(
      "UPDATE users SET is_active = false WHERE id = ?",
      [id]
    );
    return result.changes > 0;
  }
}

module.exports = new UserService();
