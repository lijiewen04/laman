import patientService from "../services/patientService.js";
import { createResponse } from "../middleware/auth.js";

export const createPatient = async (req, res) => {
  try {
    const patientData = req.body;
    const createdBy = req.user.id;

    // 检查流水号是否已存在
    const serialNoExists = await patientService.checkSerialNoExists(
      patientData.serialNo
    );
    if (serialNoExists) {
      return res.json(createResponse(4001, "流水号已存在"));
    }

    const patient = await patientService.createPatient(patientData, createdBy);

    res.json(createResponse(0, "病人创建成功", patient));
  } catch (error) {
    console.error("创建病人错误:", error);
    res.json(createResponse(5001, "服务器错误，请稍后重试"));
  }
};

export const getPatientList = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      name,
      abbr,
      serialNo,
      inpatientOutpatient,
      isTested,
      diagnosis,
      group,
      gender,
      ageMin,
      ageMax,
      caseNo,
      tStage,
      nStage,
      mStage,
      stage,
      preTreatment,
      treatmentType,
      memo,
      createdBy,
      timeStart,
      timeEnd,
    } = req.body;

    const filter = {};
    if (name) filter.name = name;
    if (abbr) filter.abbr = abbr;
    if (serialNo) filter.serialNo = serialNo;
    if (inpatientOutpatient) filter.inpatientOutpatient = inpatientOutpatient;
    if (isTested !== undefined) filter.isTested = isTested;
    if (diagnosis) filter.diagnosis = diagnosis;
    if (group) filter.group = group;
    if (gender) filter.gender = gender;
    if (ageMin !== undefined) filter.ageMin = Number(ageMin);
    if (ageMax !== undefined) filter.ageMax = Number(ageMax);
    if (caseNo) filter.caseNo = caseNo;
    if (tStage) filter.tStage = tStage;
    if (nStage) filter.nStage = nStage;
    if (mStage) filter.mStage = mStage;
    if (stage) filter.stage = stage;
    if (treatmentType) filter.treatmentType = treatmentType;
    if (memo) filter.memo = memo;
    if (createdBy !== undefined) filter.createdBy = createdBy;

    // 解析时间范围：支持数字时间戳或可解析的时间字符串
    function parseToTimestamp(v) {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v === "number" && !Number.isNaN(v)) return Number(v);
      if (typeof v === "string") {
        // 尝试直接解析
        let t = Date.parse(v);
        if (Number.isNaN(t)) {
          // 尝试把空格替换为 'T'（常见的 'YYYY-MM-DD HH:MM:SS'）
          t = Date.parse(v.replace(" ", "T"));
        }
        if (Number.isNaN(t)) {
          // 尝试在末尾加 Z 作为 UTC 标记
          t = Date.parse(v.replace(" ", "T") + "Z");
        }
        if (Number.isNaN(t)) {
          throw new Error(`无法解析时间: ${v}`);
        }
        return Number(t);
      }
      throw new Error(`不支持的时间类型: ${typeof v}`);
    }

    // 解析布尔型输入（支持 true/false, 1/0, 'yes'/'no' 等）
    function parseToBoolean(v) {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v === 1;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["1", "true", "t", "yes", "y"].includes(s)) return true;
        if (["0", "false", "f", "no", "n"].includes(s)) return false;
        throw new Error(`无法解析布尔值: ${v}`);
      }
      throw new Error(`不支持的布尔类型: ${typeof v}`);
    }

    try {
      if (timeStart) filter.timeStart = parseToTimestamp(timeStart);
      if (timeEnd) filter.timeEnd = parseToTimestamp(timeEnd);

      // 解析 preTreatment（如果请求中提供）
      if (preTreatment !== undefined) {
        try {
          const pb = parseToBoolean(preTreatment);
          if (pb !== undefined) filter.preTreatment = pb;
        } catch (e) {
          return res.json(createResponse(4009, "preTreatment 格式无效，请使用 true/false 或可解析的字符串/数字"));
        }
      }
    } catch (e) {
      console.warn("时间解析错误:", e.message);
      return res.json(createResponse(4009, "时间格式无效，请使用可解析的时间字符串或时间戳"));
    }

    const result = await patientService.getPatients(
      filter,
      parseInt(page),
      parseInt(limit)
    );

    // 确保返回的数据格式与 PatientListItem 完全一致
    const patientList = result.patients.map((patient) => ({
      id: patient.id,
      abbr: patient.abbr,
      time: patient.time,
      name: patient.name,
      serialNo: patient.serialNo,
      inpatientOutpatient: patient.inpatientOutpatient,
      group: patient.group,
      gender: patient.gender,
      age: patient.age,
      caseNo: patient.caseNo,
      diagnosis: patient.diagnosis,
      isTested: patient.isTested,
      tStage: patient.tStage || undefined,
      nStage: patient.nStage || undefined,
      mStage: patient.mStage || undefined,
      stage: patient.stage || undefined,
      preTreatment: patient.preTreatment === null || patient.preTreatment === undefined ? undefined : !!patient.preTreatment,
      treatmentType: patient.treatmentType || undefined,
      memo: patient.memo,
    }));

    // 返回带分页信息的结果
    res.json(
      createResponse(0, "获取病人列表成功", {
        items: patientList,
        pagination: {
          page: Number(result.page || page),
          limit: Number(result.limit || limit),
          total: Number(result.total || 0),
          totalPages: Number(result.totalPages || Math.ceil((result.total || 0) / (result.limit || limit))),
        },
      })
    );
  } catch (error) {
    console.error("获取病人列表错误:", error);
    const msg = String(error && error.message ? error.message : error);
    // 如果是类型转换/解析导致的错误，返回 400x 系列的自定义错误码，便于前端区分
    if (/convert|conversion|Could not convert|无法解析|invalid|类型/i.test(msg)) {
      return res.json(createResponse(4009, "查询参数格式错误: " + msg));
    }
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const getPatientDetail = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "病人ID不能为空"));
    }

    const patient = await patientService.getPatientById(id);

    if (!patient) {
      return res.json(createResponse(4002, "病人不存在"));
    }

    // 确保返回的数据格式与 PatientListItem 完全一致
    const patientDetail = {
      id: patient.id,
      abbr: patient.abbr,
      time: patient.time,
      name: patient.name,
      serialNo: patient.serialNo,
      inpatientOutpatient: patient.inpatientOutpatient,
      group: patient.group,
      gender: patient.gender,
      age: patient.age,
      caseNo: patient.caseNo,
      diagnosis: patient.diagnosis,
      isTested: patient.isTested,
      tStage: patient.tStage || undefined,
      nStage: patient.nStage || undefined,
      mStage: patient.mStage || undefined,
      stage: patient.stage || undefined,
      preTreatment: patient.preTreatment === null || patient.preTreatment === undefined ? undefined : !!patient.preTreatment,
      treatmentType: patient.treatmentType || undefined,
      memo: patient.memo,
    };

    res.json(createResponse(0, "获取病人详情成功", patientDetail));
  } catch (error) {
    console.error("获取病人详情错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const updatePatient = async (req, res) => {
  try {
    const { id, ...updateData } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "病人ID不能为空"));
    }

    // 检查病人是否存在
    const existingPatient = await patientService.getPatientById(id);
    if (!existingPatient) {
      return res.json(createResponse(4002, "病人不存在"));
    }

    // 检查流水号是否被其他病人使用
    if (
      updateData.serialNo &&
      updateData.serialNo !== existingPatient.serialNo
    ) {
      const serialNoExists = await patientService.checkSerialNoExists(
        updateData.serialNo,
        id
      );
      if (serialNoExists) {
        return res.json(createResponse(4003, "流水号已被其他病人使用"));
      }
    }

    const updatedPatient = await patientService.updatePatient(id, updateData);

    // 确保返回的数据格式与 PatientListItem 完全一致
    const patientResponse = {
      id: updatedPatient.id,
      abbr: updatedPatient.abbr,
      time: updatedPatient.time,
      name: updatedPatient.name,
      serialNo: updatedPatient.serialNo,
      inpatientOutpatient: updatedPatient.inpatientOutpatient,
      group: updatedPatient.group,
      gender: updatedPatient.gender,
      age: updatedPatient.age,
      caseNo: updatedPatient.caseNo,
      diagnosis: updatedPatient.diagnosis,
      isTested: updatedPatient.isTested,
      tStage: updatedPatient.tStage || undefined,
      nStage: updatedPatient.nStage || undefined,
      mStage: updatedPatient.mStage || undefined,
      stage: updatedPatient.stage || undefined,
      preTreatment: updatedPatient.preTreatment,
      treatmentType: updatedPatient.treatmentType || undefined,
      memo: updatedPatient.memo,
    };

    res.json(createResponse(0, "病人信息更新成功", patientResponse));
  } catch (error) {
    console.error("更新病人信息错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const deletePatient = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, "病人ID不能为空"));
    }

    // 检查病人是否存在
    const existingPatient = await patientService.getPatientById(id);
    if (!existingPatient) {
      return res.json(createResponse(4002, "病人不存在"));
    }

    const deleted = await patientService.deletePatient(id);

    if (deleted) {
      res.json(createResponse(0, "病人删除成功"));
    } else {
      res.json(createResponse(4004, "删除病人失败"));
    }
  } catch (error) {
    console.error("删除病人错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const getGroups = async (req, res) => {
  try {
    const groups = await patientService.getGroups();

    res.json(
      createResponse(0, "获取分组列表成功", {
        groups,
      })
    );
  } catch (error) {
    console.error("获取分组列表错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};

export const getStatistics = async (req, res) => {
  try {
    const stats = await patientService.getStatistics();
    res.json(createResponse(0, "获取统计数据成功", stats));
  } catch (error) {
    console.error("获取统计数据错误:", error);
    res.json(createResponse(5001, "服务器错误"));
  }
};
