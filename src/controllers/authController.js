import userService from "../services/userService.js";
import jwt from "jsonwebtoken";
import { createResponse } from "../middleware/auth.js";

// 生成JWT令牌
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

export const register = async (req, res) => {
  try {
    const {
      username,
      password,
      department,
      phone,
    } = req.body;

    // 注册时不允许客户端指定权限，默认设为 "访客"
    const userPermission = "访客";
    // 部门默认值为 "访客"（如果没有传入）
    const userDepartment = department || "访客";

    // 检查用户是否已存在
    const userExists = await userService.checkUserExists(username);

    if (userExists) {
      return res.json(createResponse(3001, "用户名已存在"));
    }

    // 创建用户
    const user = await userService.createUser({
      username,
      password,
      userPermission,
      department: userDepartment,
      phone,
    });

    // 生成令牌
    const token = generateToken(user.id);

    res.json(
      createResponse(0, "用户注册成功", {
        token,
        user: {
          id: user.id,
          username: user.username,
          userPermission: user.userPermission,
        },
      })
    );
  } catch (error) {
    console.error("注册错误:", error);
    res.json(createResponse(5001, "服务器错误，请稍后重试"));
  }
};

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // 查找用户
    const user = await userService.getUserByUsername(username);

    if (!user) {
      return res.json(createResponse(3002, "用户名或密码错误"));
    }

    // 检查密码
    const isPasswordCorrect = await userService.validatePassword(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.json(createResponse(3002, "用户名或密码错误"));
    }

    if (!user.is_active) {
      return res.json(createResponse(3003, "账户已被禁用，请联系管理员"));
    }

    // 生成令牌
    const token = generateToken(user.id);

    res.json(createResponse(0, "登录成功", token));
  } catch (error) {
    console.error("登录错误:", error);
    res.json(createResponse(5001, "服务器错误，请稍后重试"));
  }
};

export const getMe = async (req, res) => {
  try {
    const userInfo = {
      id: req.user.id,
      username: req.user.username,
      userPermission: req.user.userPermission,
      department: req.user.department,
      phone: req.user.phone,
    };

    res.json(createResponse(0, "获取用户信息成功", userInfo));
  } catch (error) {
    console.error("获取用户信息错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const getUserList = async (req, res) => {
  try {
    const { page = 1, limit = 20, username, department, userPermission } = req.body;

    const filter = {};
    if (username) filter.username = username;
    if (department) filter.department = department;
    if (userPermission) filter.userPermission = userPermission;

    // 使用 service 层的 SQL 过滤与分页
    const result = await userService.getUsers(filter, Number(page), Number(limit));

    const items = result.users.map((user) => ({
      id: user.id,
      username: user.username,
      userPermission: user.userPermission,
      department: user.department || undefined,
      phone: user.phone || undefined,
    }));

    res.json(
      createResponse(0, "获取用户列表成功", {
        items,
        pagination: {
          page: Number(result.page),
          limit: Number(result.limit),
          total: Number(result.total),
          totalPages: Number(result.totalPages),
        },
      })
    );
  } catch (error) {
    console.error("获取用户列表错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { username, department, phone } = req.body;
    const userId = req.user.id;

    // 检查用户名是否已被其他用户使用
    if (username && username !== req.user.username) {
      const existingUser = await userService.getUserByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        return res.json(createResponse(3004, "用户名已被使用"));
      }
    }

    // 仅包含实际要更新的字段，避免不必要地更新其他列
    const updateData = {};
    if (username && username !== req.user.username) updateData.username = username;
    if (department !== undefined) updateData.department = department;
    if (phone !== undefined) updateData.phone = phone;

    const updatedUser = await userService.updateUser(userId, updateData);

    const userInfo = {
      username: updatedUser.username,
      userPermission: updatedUser.userPermission,
      department: updatedUser.department,
      phone: updatedUser.phone,
    };

    res.json(createResponse(0, "用户信息更新成功", userInfo));
  } catch (error) {
    console.error("更新用户信息错误:", error);
    // 开发环境下返回更多错误信息以便调试，生产环境仍然隐藏详细信息
    const devData = process.env.NODE_ENV !== "production" ? { message: error.message, stack: error.stack } : null;
    res.json(createResponse(5001, "服务器错误", devData));
  }
};

export const updateUserPermission = async (req, res) => {
  try {
    // 改为使用用户 id 作为标识
    const { id, userPermission } = req.body;

    if (!id || !userPermission) {
      return res.json(createResponse(4001, "用户ID和权限不能为空"));
    }

    // 验证权限类型
    if (!["超级管理员", "管理员", "用户", "访客"].includes(userPermission)) {
      return res.json(createResponse(4002, "权限类型无效"));
    }

    const user = await userService.getUserById(id);
    if (!user) {
      return res.json(createResponse(4003, "用户不存在"));
    }

    const updatedUser = await userService.updateUserPermissionById(id, userPermission);

    res.json(
      createResponse(0, "用户权限更新成功", {
        id: updatedUser.id,
        username: updatedUser.username,
        userPermission: updatedUser.userPermission,
      })
    );
  } catch (error) {
    console.error("更新用户权限错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const deleteUser = async (req, res) => {
  try {
    // 改为使用用户 id
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "用户ID不能为空"));
    }

    const user = await userService.getUserById(id);
    if (!user) {
      return res.json(createResponse(4003, "用户不存在"));
    }

    // 不能删除自己
    if (user.id === req.user.id) {
      return res.json(createResponse(4004, "不能删除自己的账户"));
    }

    // 在删除前检查是否存在引用，防止潜在的外键约束或数据不一致
    const refs = await userService.countUserReferences(id);
    const nonZero = Object.entries(refs).filter(([, cnt]) => Number(cnt) > 0);
    if (nonZero.length > 0) {
      const details = nonZero.map(([k, v]) => `${k}: ${v}`).join(", ");
      return res.json(
        createResponse(4006, `用户存在引用，无法删除，请先清理相关引用 (${details})`)
      );
    }

    const deleted = await userService.deleteUser(id);

    if (deleted) {
      res.json(createResponse(0, "用户删除成功"));
    } else {
      res.json(createResponse(4005, "删除用户失败"));
    }
  } catch (error) {
    console.error("删除用户错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};