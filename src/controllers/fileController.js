import fileService from '../services/fileService.js';
import patientService from '../services/patientService.js';
import { createResponse } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';

// 文件上传
export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.json(createResponse(4001, '请选择要上传的文件'));
    }
    const { fileType = '其他', description = '', patientId } = req.body;
    // patientId 必填
    if (patientId === undefined || patientId === null || isNaN(Number(patientId))) {
      return res.json(createResponse(4001, '需要提供有效的 patientId'));
    }
    const uploadedBy = req.user.id;

    // 根据文件扩展名确定文件类型
    const detectedFileType = detectFileType(req.file.originalname, req.file.mimetype);
    const finalFileType = fileType !== '其他' ? fileType : detectedFileType;

    // 提取文件元数据
    const metadata = await extractFileMetadata(req.file, finalFileType);

    const fileRecord = await fileService.createFileRecord(
      {
        ...req.file,
        fileType: finalFileType,
        description,
        metadata,
        patientId: Number(patientId),
      },
      uploadedBy
    );

    // 返回文件信息
    const fileInfo = {
      id: fileRecord.id,
      filename: fileRecord.filename,
      originalName: fileRecord.originalName,
      mimeType: fileRecord.mimeType,
      size: fileRecord.size,
      fileType: fileRecord.fileType,
      description: fileRecord.description,
      metadata: fileRecord.metadata,
      patientId: fileRecord.patientId,
      patientName: fileRecord.patientName,
      downloadCount: fileRecord.downloadCount,
      createdAt: fileRecord.createdAt,
      uploadedBy: fileRecord.uploadedByUsername,
    };

    res.json(createResponse(0, '文件上传成功', fileInfo));
  } catch (error) {
    console.error('文件上传错误:', error);

    // 如果上传失败，删除已保存的文件
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('删除文件失败:', unlinkError);
      }
    }

    res.json(createResponse(5001, '文件上传失败'));
  }
};

// 文件下载
export const downloadFile = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, '文件ID不能为空'));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, '文件不存在'));
    }

    // 权限检查（先判断权限，若无权限直接返回）
    let hasPermission = fileService.canUserDownload(req.user.userPermission);

    // 如果是访客，检查是否有下载授权；返回结构化结果以区分过期与未授权
    if (!hasPermission && req.user.userPermission === '访客') {
      const authResult = await fileService.checkDownloadAuthorization(id, req.user.id);

      // 兼容旧版返回（布尔）和新版对象返回
      if (typeof authResult === 'object') {
        if (authResult.authorized) {
          hasPermission = true;
        } else {
          const msg =
            authResult.reason === '授权已过期'
              ? '下载授权已过期，请联系超级管理员重新授权'
              : '没有下载权限，请联系超级管理员授权';
          return res.json(createResponse(4004, msg));
        }
      } else {
        hasPermission = Boolean(authResult);
      }
    }

    if (!hasPermission) {
      return res.json(createResponse(4004, '没有下载权限，请联系超级管理员授权'));
    }

    if (!fs.existsSync(fileRecord.filePath)) {
      return res.json(createResponse(4003, '文件不存在或已被删除'));
    }

    if (!hasPermission) {
      return res.json(createResponse(4004, '没有下载权限，请联系超级管理员授权'));
    }

    // 增加下载次数
    await fileService.incrementDownloadCount(id);

    // 设置下载头信息
    res.setHeader('Content-Type', fileRecord.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.originalName)}"`);
    res.setHeader('Content-Length', fileRecord.size);

    // 发送文件
    const fileStream = fs.createReadStream(fileRecord.filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('文件下载错误:', error);
    res.json(createResponse(5001, '文件下载失败'));
  }
};

// 获取文件列表
export const getFileList = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      fileType,
      uploadedBy,
      uploadedById,
      patientId,
      filename,
      originalName,
      mimeType,
      minSize,
      maxSize,
      description,
      createdAtStart,
      createdAtEnd,
    } = req.body;

    const filter = {};
    if (fileType) filter.fileType = fileType;
    if (uploadedBy) filter.uploadedBy = uploadedBy;
    if (uploadedById !== undefined) filter.uploadedById = uploadedById;
    if (patientId !== undefined) filter.patientId = patientId;
    if (filename) filter.filename = filename;
    if (originalName) filter.originalName = originalName;
    if (mimeType) filter.mimeType = mimeType;
    if (minSize !== undefined) filter.minSize = Number(minSize);
    if (maxSize !== undefined) filter.maxSize = Number(maxSize);
    if (description) filter.description = description;
    if (createdAtStart) filter.createdAtStart = createdAtStart;
    if (createdAtEnd) filter.createdAtEnd = createdAtEnd;

    const result = await fileService.getFiles(filter, parseInt(page), parseInt(limit));

    res.json(
      createResponse(0, '获取文件列表成功', {
        files: result.files,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      })
    );
  } catch (error) {
    console.error('获取文件列表错误:', error);
    res.json(createResponse(5001, '服务器错误'));
  }
};

// 根据 file id 返回文件信息以及对应的病人详情（与 /api/patient/detail 返回格式一致）
export const getFileWithPatientDetail = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, '文件ID不能为空'));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, '文件不存在'));
    }

    // 获取病人信息（file 表包含 patient_id 字段）
    const patientId = fileRecord.patientId;
    if (!patientId) {
      return res.json(createResponse(4002, '文件未关联病人'));
    }

    const patient = await patientService.getPatientById(patientId);

    if (!patient) {
      return res.json(createResponse(4002, '病人不存在'));
    }

    // 按照 /api/patient/detail 的返回结构格式化病人信息
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
      preTreatment:
        patient.preTreatment === null || patient.preTreatment === undefined ? undefined : !!patient.preTreatment,
      treatmentType: patient.treatmentType || undefined,
      memo: patient.memo,
    };

    // 返回文件信息和病人详情
    res.json(
      createResponse(0, '获取文件及病人详情成功', {
        file: fileRecord,
        patient: patientDetail,
      })
    );
  } catch (error) {
    console.error('获取文件及病人详情错误:', error);
    res.json(createResponse(5001, '服务器错误'));
  }
};

// 删除文件
export const deleteFile = async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json(createResponse(4001, '文件ID不能为空'));
    }

    const fileRecord = await fileService.getFileById(id);

    if (!fileRecord) {
      return res.json(createResponse(4002, '文件不存在'));
    }

    // 只有超级管理员可以删除文件
    const deleted = await fileService.deleteFile(id);

    if (deleted) {
      // 物理删除文件
      try {
        if (fs.existsSync(fileRecord.filePath)) {
          fs.unlinkSync(fileRecord.filePath);
        }
      } catch (unlinkError) {
        console.error('物理删除文件失败:', unlinkError);
      }

      res.json(createResponse(0, '文件删除成功'));
    } else {
      res.json(createResponse(4005, '删除文件失败'));
    }
  } catch (error) {
    console.error('删除文件错误:', error);
    res.json(createResponse(5001, '服务器错误'));
  }
};

// 获取文件类型列表
export const getFileTypes = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.body;
    const types = await fileService.getFileTypes();

    const total = Array.isArray(types) ? types.length : 0;
    const p = Number(page);
    const l = Number(limit);
    const start = (p - 1) * l;
    const items = Array.isArray(types) ? types.slice(start, start + l) : [];

    res.json(
      createResponse(0, '获取文件类型成功', {
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
    console.error('获取文件类型错误:', error);
    res.json(createResponse(5001, '服务器错误'));
  }
};

// 授权访客下载（支持 userId 或 username）
export const authorizeDownload = async (req, res) => {
  try {
    const { fileId, userId, expiresIn = 24, requestId, action } = req.body;

    // 如果传入 requestId，则管理员在处理访客申请（approve/reject）
    if (requestId !== undefined && requestId !== null) {
      // 仅超级管理员可到达此路由（路由层已限制），调用 service 处理
      const result = await fileService.processDownloadRequest(Number(requestId), action, req.user.id, expiresIn);

      if (result && result.success) {
        if (result.action === 'approved') {
          return res.json(
            createResponse(0, '已批准下载申请', {
              username: result.authorization.username,
              fileId: result.authorization.fileId,
              expiresAt: result.authorization.expiresAt
            })
          );
        }
        return res.json(createResponse(0, '已拒绝下载申请'));
      }

      if (result && result.reason === 'already_processed') {
        return res.json(createResponse(4007, `该申请已被处理: ${result.status}`));
      }

      return res.json(createResponse(5001, '处理申请失败'));
    }

    // 否则按原先逻辑直接为指定用户授权
    if (!fileId || userId === undefined || userId === null) {
      return res.json(createResponse(4001, '文件ID和用户ID不能为空'));
    }

    const result = await fileService.authorizeDownload(fileId, userId, expiresIn);

    if (result && result.success) {
      res.json(
        createResponse(0, '下载授权成功', {
          username: result.username,
          fileId: result.fileId,
          expiresAt: result.expiresAt,
        })
      );
    } else {
      res.json(createResponse(4008, '下载授权失败'));
    }
  } catch (error) {
    console.error('下载授权错误:', error);
    res.json(createResponse(5001, error.message));
  }
};

// 访客提交下载申请
export const requestDownload = async (req, res) => {
  try {
    const { fileId, message = '' } = req.body;

    if (!fileId) {
      return res.json(createResponse(4001, '文件ID不能为空'));
    }

    // 仅访客需要提交申请
    if (req.user.userPermission !== '访客') {
      return res.json(createResponse(4006, '无需请求权限'));
    }

    const result = await fileService.createDownloadRequest(Number(fileId), req.user.id, message);

    if (result.success) {
      return res.json(createResponse(0, '提交申请成功', result.request));
    }

    // 处理不同的失败原因
    if (result.reason === 'not_needed') {
      return res.json(createResponse(4006, '无需请求权限'));
    }

    if (result.reason === 'already_pending') {
      return res.json(createResponse(4007, '已有未处理的下载申请'));
    }

    return res.json(createResponse(5001, '提交申请失败'));
  } catch (error) {
    console.error('提交下载申请错误:', error);
    // 如果是文件不存在，返回友好提示
    if (error && typeof error.message === 'string' && error.message.indexOf('文件不存在') !== -1) {
      return res.json(createResponse(4002, '文件不存在'));
    }

    // 如果是用户不存在或参数错误，返回相应提示
    if (error && typeof error.message === 'string' && error.message.indexOf('用户不存在') !== -1) {
      return res.json(createResponse(4002, '用户不存在'));
    }

    return res.json(createResponse(5001, '提交申请失败'));
  }
};

// 超级管理员获取下载申请列表
export const getRequestList = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, fileId, userId, patientName, patientGroup } = req.body;

    const filter = {};
    if (status) filter.status = status;
    if (fileId !== undefined) filter.fileId = fileId;
    if (userId !== undefined) filter.userId = userId;
    if (patientName) filter.patientName = patientName;
    if (patientGroup) filter.patientGroup = patientGroup;

    const result = await fileService.getDownloadRequests(filter, Number(page), Number(limit));

    return res.json(
      createResponse(0, '获取申请列表成功', {
        items: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      })
    );
  } catch (error) {
    console.error('获取申请列表错误:', error);
    return res.json(createResponse(5001, '获取申请列表失败'));
  }
};

// 辅助函数：检测文件类型
function detectFileType(originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();

  const typeMap = {
    '.csv': 'CSV',
    '.xls': 'Excel',
    '.xlsx': 'Excel',
    '.pdf': 'PDF',
    '.doc': 'Word',
    '.docx': 'Word',
    '.txt': '文本',
    '.jpg': '图片',
    '.jpeg': '图片',
    '.png': '图片',
    '.gif': '图片',
  };

  return typeMap[ext] || '其他';
}

// 辅助函数：提取文件元数据
async function extractFileMetadata(file, fileType) {
  const metadata = {
    originalName: file.originalname,
    uploadTime: new Date().toISOString(),
    fileType: fileType,
  };

  try {
    if (fileType === 'CSV') {
      const preview = await fileService.parseCSV(file.path);
      metadata.rowCount = preview.length;
      if (preview.length > 0) {
        metadata.columns = Object.keys(preview[0]);
      }
    } else if (fileType === 'Excel') {
      const preview = await fileService.parseExcel(file.path);
      const firstSheet = Object.keys(preview)[0];
      metadata.sheetCount = Object.keys(preview).length;
      metadata.sheets = Object.keys(preview);
      if (preview[firstSheet].length > 0) {
        metadata.columns = Object.keys(preview[firstSheet][0]);
      }
    }
  } catch (error) {
    console.error('提取文件元数据失败:', error);
  }

  return metadata;
}

// functions are exported inline above
