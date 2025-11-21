import db from "../database/duckdb.js";

class PatientService {
  // 创建病人
  async createPatient(patientData, createdBy) {
    const {
      abbr,
      time,
      name,
      serialNo,
      inpatientOutpatient,
      group,
      gender,
      age,
      caseNo,
      diagnosis,
      isTested,
      tStage,
      nStage,
      mStage,
      stage,
      preTreatment,
      treatmentType,
      memo,
    } = patientData;

    const inserted = await db.get(
      `INSERT INTO patients (
        abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage,
        mStage, stage, preTreatment, treatmentType, memo, createdBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        abbr,
        time,
        name,
        serialNo,
        inpatientOutpatient,
        group,
        gender,
        age,
        caseNo,
        diagnosis,
        isTested,
        tStage,
        nStage,
        mStage,
        stage,
        preTreatment,
        treatmentType,
        memo,
        createdBy,
      ].map((v) => (v === undefined ? null : v))
    );

    const patient = await this.getPatientById(inserted.id);
    return patient;
  }

  // 根据ID获取病人
  async getPatientById(id) {
    return await db.get(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients WHERE id = ?`,
      [id]
    );
  }

  // 根据流水号获取病人
  async getPatientBySerialNo(serialNo) {
    return await db.get(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients WHERE serialNo = ?`,
      [serialNo]
    );
  }

  // 获取所有病人列表（支持分页和筛选）
  async getPatients(filter = {}, page = 1, limit = 20) {
    let whereClause = "WHERE 1=1";
    const params = [];
    let paramIndex = 1;

    // 构建筛选条件
    if (filter.name) {
      whereClause += ` AND name LIKE ?`;
      params.push(`%${filter.name}%`);
      paramIndex++;
    }

    if (filter.serialNo) {
      whereClause += ` AND serialNo LIKE ?`;
      params.push(`%${filter.serialNo}%`);
      paramIndex++;
    }

    if (filter.inpatientOutpatient) {
      whereClause += ` AND inpatientOutpatient = ?`;
      params.push(filter.inpatientOutpatient);
      paramIndex++;
    }

    if (filter.isTested !== undefined) {
      whereClause += ` AND isTested = ?`;
      params.push(filter.isTested);
      paramIndex++;
    }

    if (filter.diagnosis) {
      whereClause += ` AND diagnosis LIKE ?`;
      params.push(`%${filter.diagnosis}%`);
      paramIndex++;
    }

    if (filter.group) {
      whereClause += ` AND "group" = ?`;
      params.push(filter.group);
      paramIndex++;
    }

    // 计算分页
    const offset = (page - 1) * limit;

    // 获取总数（DuckDB 可能返回 BigInt）
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM patients ${whereClause}`,
      params
    );
    // 将可能的 BigInt 转为 Number，以免与普通 Number 混合运算时报错
    const total = typeof countResult.total === "bigint" ? Number(countResult.total) : countResult.total;

    // 获取数据
    const patients = await db.all(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients 
       ${whereClause}
       ORDER BY time DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      patients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 更新病人信息
  async updatePatient(id, updateData) {
    const {
      abbr,
      time,
      name,
      serialNo,
      inpatientOutpatient,
      group,
      gender,
      age,
      caseNo,
      diagnosis,
      isTested,
      tStage,
      nStage,
      mStage,
      stage,
      preTreatment,
      treatmentType,
      memo,
    } = updateData;

    await db.run(
      `UPDATE patients SET 
        abbr = ?, time = ?, name = ?, serialNo = ?, inpatientOutpatient = ?, "group" = ?,
        gender = ?, age = ?, caseNo = ?, diagnosis = ?, isTested = ?, tStage = ?, nStage = ?,
        mStage = ?, stage = ?, preTreatment = ?, treatmentType = ?, memo = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        abbr,
        time,
        name,
        serialNo,
        inpatientOutpatient,
        group,
        gender,
        age,
        caseNo,
        diagnosis,
        isTested,
        tStage,
        nStage,
        mStage,
        stage,
        preTreatment,
        treatmentType,
        memo,
        id,
      ].map((v) => (v === undefined ? null : v))
    );

    return await this.getPatientById(id);
  }

  // 删除病人
  async deletePatient(id) {
    const result = await db.run("DELETE FROM patients WHERE id = ?", [id]);
    return result.changes > 0;
  }

  // 不再使用 last_insert_rowid(); 使用 INSERT ... RETURNING 获取插入 id

  // 检查流水号是否存在
  async checkSerialNoExists(serialNo, excludeId = null) {
    let sql = "SELECT id FROM patients WHERE serialNo = ?";
    const params = [serialNo];

    if (excludeId) {
      sql += " AND id != ?";
      params.push(excludeId);
    }

    const existingPatient = await db.get(sql, params);
    return existingPatient !== null;
  }

  // 获取分组列表
  async getGroups() {
    const groups = await db.all(
      'SELECT DISTINCT "group" FROM patients WHERE "group" IS NOT NULL ORDER BY "group"'
    );
    return groups.map((g) => g.group);
  }

  // 获取统计数据
  async getStatistics() {
    const stats = await db.all(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN isTested = true THEN 1 END) as tested,
        COUNT(CASE WHEN inpatientOutpatient = '住院' THEN 1 END) as inpatient,
        COUNT(CASE WHEN inpatientOutpatient = '门诊' THEN 1 END) as outpatient
      FROM patients
    `);
    return stats[0];
  }
}

export default new PatientService();
