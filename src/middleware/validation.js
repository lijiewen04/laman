import { createResponse } from "./auth.js";

export const validateRegister = (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json(createResponse(2001, "请提供用户名和密码"));
  }

  if (password.length < 6) {
    return res.json(createResponse(2002, "密码至少6个字符"));
  }

  if (username.length < 3) {
    return res.json(createResponse(2003, "用户名至少3个字符"));
  }

  // 验证权限类型
  if (
    req.body.userPermission &&
    !["超级管理员", "管理员", "用户", "访客"].includes(req.body.userPermission)
  ) {
    return res.json(
      createResponse(2005, "权限类型无效，必须是：超级管理员、管理员、用户或访客")
    );
  }

  next();
};

export const validateLogin = (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json(createResponse(2006, "请提供用户名和密码"));
  }

  next();
};

// exports are declared inline above
