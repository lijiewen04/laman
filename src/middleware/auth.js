import jwt from "jsonwebtoken";
import userService from "../services/userService.js";

// 统一响应格式
export const createResponse = (status, msg, data = null) => {
  return {
    status,
    msg,
    data,
  };
};

// 验证JWT令牌
export const protect = async (req, res, next) => {
  try {
    let token;

    // 从请求头获取token
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // 从请求体获取token（POST请求）
    if (!token && req.body.token) {
      token = req.body.token;
    }

    if (!token) {
      return res.json(createResponse(1001, "访问被拒绝，请提供有效的令牌"));
    }

    // 验证令牌
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 获取用户信息
    const user = await userService.getUserById(decoded.id);

    if (!user) {
      return res.json(createResponse(1002, "用户不存在"));
    }

    if (!user.is_active) {
      return res.json(createResponse(1003, "账户已被禁用"));
    }

    req.user = user;
    next();
  } catch (error) {
    return res.json(createResponse(1004, "令牌无效"));
  }
};

// 授权中间件（检查权限）
export const authorize = (...permissions) => {
  return (req, res, next) => {
    if (!permissions.includes(req.user.user_permission)) {
      return res.json(
        createResponse(1005, `权限不足，需要 ${permissions.join("或")} 权限`)
      );
    }
    next();
  };
};
