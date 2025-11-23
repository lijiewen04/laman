import { createResponse } from "./auth.js";

export const validatePatientCreate = (req, res, next) => {
  const { abbr, time, name, serialNo, inpatientOutpatient } = req.body;

  if (!abbr || !time || !name || !serialNo || !inpatientOutpatient) {
    return res.json(
      createResponse(4001, "缩写、时间、姓名、流水号和住院/门诊类型为必填项")
    );
  }

  if (typeof time !== "number" || time <= 0) {
    return res.json(createResponse(4002, "时间必须为正整数时间戳"));
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return res.json(createResponse(4003, "姓名不能为空"));
  }

  if (typeof serialNo !== "string" || serialNo.trim().length === 0) {
    return res.json(createResponse(4004, "流水号不能为空"));
  }

  if (!["住院", "门诊"].includes(inpatientOutpatient)) {
    return res.json(createResponse(4005, '住院/门诊类型必须为"住院"或"门诊"'));
  }

  if (
    req.body.age &&
    (typeof req.body.age !== "number" || req.body.age < 0 || req.body.age > 150)
  ) {
    return res.json(createResponse(4006, "年龄必须在0-150之间"));
  }

  if (req.body.gender && !["男", "女", "未知", "其他"].includes(req.body.gender)) {
    return res.json(createResponse(4007, '性别必须为"男"、"女"、"未知"或"其他"'));
  }

  if (req.body.preTreatment !== undefined) {
    const v = req.body.preTreatment;
    const ok =
      typeof v === "boolean" ||
      (typeof v === "number" && (v === 0 || v === 1)) ||
      (typeof v === "string" && ["0", "1", "true", "false", "t", "f", "yes", "no", "y", "n"].includes(v.trim().toLowerCase()));
    if (!ok) {
      return res.json(
        createResponse(4008, "采样前是否接受治疗必须为布尔值或可解析的 true/false/0/1")
      );
    }
  }

  next();
};

export const validatePatientUpdate = (req, res, next) => {
  const { id } = req.body;

  if (!id) {
    return res.json(createResponse(4001, "病人ID不能为空"));
  }

  if (
    req.body.time &&
    (typeof req.body.time !== "number" || req.body.time <= 0)
  ) {
    return res.json(createResponse(4002, "时间必须为正整数时间戳"));
  }

  if (
    req.body.name &&
    (typeof req.body.name !== "string" || req.body.name.trim().length === 0)
  ) {
    return res.json(createResponse(4003, "姓名不能为空"));
  }

  if (
    req.body.serialNo &&
    (typeof req.body.serialNo !== "string" ||
      req.body.serialNo.trim().length === 0)
  ) {
    return res.json(createResponse(4004, "流水号不能为空"));
  }

  if (
    req.body.inpatientOutpatient &&
    !["住院", "门诊"].includes(req.body.inpatientOutpatient)
  ) {
    return res.json(createResponse(4005, '住院/门诊类型必须为"住院"或"门诊"'));
  }

  if (
    req.body.age &&
    (typeof req.body.age !== "number" || req.body.age < 0 || req.body.age > 150)
  ) {
    return res.json(createResponse(4006, "年龄必须在0-150之间"));
  }

  if (req.body.gender && !["男", "女", "未知", "其他"].includes(req.body.gender)) {
    return res.json(createResponse(4007, '性别必须为"男"、"女"、"未知"或"其他"'));
  }

  if (req.body.preTreatment !== undefined) {
    const v = req.body.preTreatment;
    const ok =
      typeof v === "boolean" ||
      (typeof v === "number" && (v === 0 || v === 1)) ||
      (typeof v === "string" && ["0", "1", "true", "false", "t", "f", "yes", "no", "y", "n"].includes(v.trim().toLowerCase()));
    if (!ok) {
      return res.json(
        createResponse(4008, "采样前是否接受治疗必须为布尔值或可解析的 true/false/0/1")
      );
    }
  }

  next();
};

// exports are declared inline above
