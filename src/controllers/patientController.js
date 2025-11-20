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
      serialNo,
      inpatientOutpatient,
      isTested,
      diagnosis,
      group,
    } = req.body;

    const filter = {};
    if (name) filter.name = name;
    if (serialNo) filter.serialNo = serialNo;
    if (inpatientOutpatient) filter.inpatientOutpatient = inpatientOutpatient;
    if (isTested !== undefined) filter.isTested = isTested;
    if (diagnosis) filter.diagnosis = diagnosis;
    if (group) filter.group = group;

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
      preTreatment: patient.preTreatment,
      treatmentType: patient.treatmentType || undefined,
      memo: patient.memo,
    }));

    res.json(createResponse(0, "获取病人列表成功", patientList));
  } catch (error) {
    console.error("获取病人列表错误:", error);
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
      preTreatment: patient.preTreatment,
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
    res.json(createResponse(0, "获取分组列表成功", groups));
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
