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
      userPermission = "访客",
      department,
      phone,
    } = req.body;

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
      department,
      phone,
    });

    // 生成令牌
    const token = generateToken(user.id);

    res.json(
      createResponse(0, "用户注册成功", {
        token,
        user: {
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
    const { page = 1, limit = 20 } = req.body;
    const users = await userService.getAllUsers();

    // 转换为 UserListItem 格式
    const userList = users.map((user) => ({
      username: user.username,
      userPermission: user.userPermission,
      department: user.department || undefined,
      phone: user.phone || undefined,
    }));

    // 在 controller 层做简单的分页（service 层返回全部）
    const total = userList.length;
    const p = Number(page);
    const l = Number(limit);
    const start = (p - 1) * l;
    const items = userList.slice(start, start + l);

    res.json(
      createResponse(0, "获取用户列表成功", {
        items,
        pagination: {
          page: p,
          limit: l,
          total,
          totalPages: Math.ceil(total / l),
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
    const { username, userPermission, department, phone } = req.body;
    const userId = req.user.id;

    // 检查用户名是否已被其他用户使用
    if (username && username !== req.user.username) {
      const existingUser = await userService.getUserByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        return res.json(createResponse(3004, "用户名已被使用"));
      }
    }

    const updatedUser = await userService.updateUser(userId, {
      username: username || req.user.username,
      userPermission: userPermission || req.user.userPermission,
      department,
      phone,
    });

    const userInfo = {
      username: updatedUser.username,
      userPermission: updatedUser.userPermission,
      department: updatedUser.department,
      phone: updatedUser.phone,
    };

    res.json(createResponse(0, "用户信息更新成功", userInfo));
  } catch (error) {
    console.error("更新用户信息错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const updateUserPermission = async (req, res) => {
  try {
    const { username, userPermission } = req.body;

    if (!username || !userPermission) {
      return res.json(createResponse(4001, "用户名和权限不能为空"));
    }

    // 验证权限类型
    if (!["超级管理员", "管理员", "访客"].includes(userPermission)) {
      return res.json(createResponse(4002, "权限类型无效"));
    }

    const user = await userService.getUserByUsername(username);
    if (!user) {
      return res.json(createResponse(4003, "用户不存在"));
    }

    const updatedUser = await userService.updateUserPermission(
      username,
      userPermission
    );

    res.json(
      createResponse(0, "用户权限更新成功", {
        username: updatedUser.username,
        userPermission: updatedUser.user_permission,
      })
    );
  } catch (error) {
    console.error("更新用户权限错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.json(createResponse(4001, "用户名不能为空"));
    }

    const user = await userService.getUserByUsername(username);
    if (!user) {
      return res.json(createResponse(4003, "用户不存在"));
    }

    // 不能删除自己
    if (user.username === req.user.username) {
      return res.json(createResponse(4004, "不能删除自己的账户"));
    }

    const deleted = await userService.deleteUser(user.id);

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