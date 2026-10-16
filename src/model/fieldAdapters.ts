/**
 * 内置字段适配器集合
 *
 * 每种飞书字段类型对应一个独立的命名导出适配器对象，实现 `FieldAdapter` 接口。
 * 读写格式严格依据 RESEARCH.md 第 4 节：
 *  - 写入格式：提交给飞书 `fields` 对象的值
 *  - 读取格式：飞书返回的 `fields` 原始值 -> 用户侧友好值
 *
 * 统一约定：
 *  - `null` / `undefined` 传入 `serialize` 返回 `null`（清空字段）；
 *  - `null` / `undefined` 传入 `deserialize` 返回 `null`；
 *  - 只读字段的 `serialize` 抛出 `BitableValidationError`。
 */

import type {
  AttachmentInfo,
  ComputedValue,
  FieldDefinition,
  FieldType,
  LocationValue,
  PersonInfo,
  UrlValue,
} from '../types';
import { FieldType as FT } from '../types';
import { BitableValidationError } from '../error';
import {
  extractEmail,
  extractTextFromRichText,
  toMilliseconds,
} from '../utils';
import { FieldAdapter, FieldAdapterRegistry } from './FieldAdapter';

// ============================================================
// 通用辅助
// ============================================================

/** 判断是否为 null / undefined */
function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/** 构造只读字段写入错误 */
function readonlyWriteError(typeName: string): never {
  throw new BitableValidationError(
    `[lark-bitable-db] 字段类型「${typeName}」为只读字段，不支持通过写入接口赋值`,
  );
}

/** 构造类型错误 */
function typeError(message: string, fieldName?: string): never {
  throw new BitableValidationError(message, undefined, undefined, { fieldName });
}

/** 只读字段类型集合（这些类型的字段由飞书自动计算/维护） */
const READONLY_TYPES = new Set<FieldType>([
  FT.Lookup,
  FT.Formula,
  FT.CreatedTime,
  FT.ModifiedTime,
  FT.CreatedUser,
  FT.ModifiedUser,
  FT.AutoNumber,
]);

/** 构造只读类型的 isReadOnly */
function readonlyIsReadOnly(fieldDef: FieldDefinition): boolean {
  return fieldDef.readonly === true || READONLY_TYPES.has(fieldDef.type);
}

/** 构造可写类型的 isReadOnly */
function writableIsReadOnly(fieldDef: FieldDefinition): boolean {
  return fieldDef.readonly === true;
}

/** 把未知值安全转成字符串 */
function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

// ============================================================
// 1. 文本 Text (type=1)
//    写入: string
//    读取: [{text, type:"text"}] 富文本数组 -> 纯文本 string
//    邮箱 (uiType=Email) 读取: [{text, link:"mailto:..."}] -> 邮箱地址
// ============================================================
export const textAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return value;
    typeError(`文本字段「${fieldDef.fieldName}」写入值必须是 string，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (fieldDef.uiType === 'Email') {
      return extractEmail(value);
    }
    return extractTextFromRichText(value);
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 2. 数字 Number (type=2)，含 Progress/Currency/Rating
//    写入: number
//    读取: number
// ============================================================
export const numberAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    // 兼容数字字符串
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    typeError(`数字字段「${fieldDef.fieldName}」写入值必须是 number，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (typeof value === 'number') return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 3. 单选 SingleSelect (type=3)
//    写入: string（选项名）
//    读取: string
// ============================================================
export const singleSelectAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return value;
    typeError(`单选字段「${fieldDef.fieldName}」写入值必须是选项名字符串，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return asString(value);
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 4. 多选 MultiSelect (type=4)
//    写入: string[]（选项名数组），兼容单个 string
//    读取: string[]
// ============================================================
export const multiSelectAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.map((v) => asString(v));
    typeError(`多选字段「${fieldDef.fieldName}」写入值必须是 string[]，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (Array.isArray(value)) return value.map((v) => asString(v));
    return [asString(value)];
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 5. 日期时间 DateTime (type=5)
//    写入: number（毫秒时间戳），支持 Date 对象自动转换
//    读取: number（毫秒时间戳）；fieldDef.returnDate === true 时返回 Date
// ============================================================
export const dateTimeAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (value instanceof Date) return toMilliseconds(value);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    typeError(
      `日期字段「${fieldDef.fieldName}」写入值必须是 number（毫秒戳）或 Date，收到 ${typeof value}`,
      fieldDef.fieldName,
    );
  },
  deserialize(value, fieldDef) {
    if (isNullish(value)) return null;
    const ts = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ts)) return null;
    // 允许用户在字段定义上附加 returnDate 配置，返回 Date 对象
    const returnDate = (fieldDef as FieldDefinition & { returnDate?: boolean }).returnDate === true;
    return returnDate ? new Date(ts) : ts;
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 7. 复选框 Checkbox (type=7)
//    写入: boolean
//    读取: boolean
// ============================================================
export const checkboxAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'boolean') return value;
    typeError(`复选框字段「${fieldDef.fieldName}」写入值必须是 boolean，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return Boolean(value);
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 11. 人员 User (type=11)
//     写入: [{id:"ou_xxx"}]，支持传 string（单个）或 string[]（多个）自动包装
//     读取: [{id,name,en_name,avatar_url,email}] -> PersonInfo[]
// ============================================================

/** 把飞书人员原始对象映射为 PersonInfo */
function mapPerson(raw: unknown): PersonInfo | null {
  if (isNullish(raw) || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.id) return null;
  return {
    id: asString(r.id),
    name: r.name ? asString(r.name) : undefined,
    enName: r.en_name ? asString(r.en_name) : undefined,
    avatarUrl: r.avatar_url ? asString(r.avatar_url) : undefined,
    email: r.email ? asString(r.email) : undefined,
  };
}

export const userAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    // 单个 id 字符串
    if (typeof value === 'string') return [{ id: value }];
    // 数组：元素可以是 id 字符串或 {id} 对象
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') return { id: item };
        if (item && typeof item === 'object' && (item as Record<string, unknown>).id) {
          return { id: asString((item as Record<string, unknown>).id) };
        }
        typeError(`人员字段「${fieldDef.fieldName}」数组项必须是 open_id 字符串或 {id} 对象`, fieldDef.fieldName);
      });
    }
    // 单个 {id} 对象
    if (value && typeof value === 'object' && (value as Record<string, unknown>).id) {
      return [{ id: asString((value as Record<string, unknown>).id) }];
    }
    typeError(
      `人员字段「${fieldDef.fieldName}」写入值必须是 string / string[] / [{id}]，收到 ${typeof value}`,
      fieldDef.fieldName,
    );
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (Array.isArray(value)) {
      return value.map(mapPerson).filter((p): p is PersonInfo => p !== null);
    }
    const single = mapPerson(value);
    return single ? [single] : [];
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 13. 电话 Phone (type=13)
//     写入: string
//     读取: string
// ============================================================
export const phoneAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return value;
    typeError(`电话字段「${fieldDef.fieldName}」写入值必须是 string，收到 ${typeof value}`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return asString(value);
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 15. 超链接 Url (type=15)
//     写入: {text, link}，支持传 string（同时作为 text 和 link）
//     读取: {text, link} -> UrlValue
// ============================================================
export const urlAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return { text: value, link: value };
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (v.link) {
        return {
          text: v.text ? asString(v.text) : asString(v.link),
          link: asString(v.link),
        };
      }
    }
    typeError(`超链接字段「${fieldDef.fieldName}」写入值必须是 {text, link} 或 string`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (typeof value === 'string') return { text: value, link: value } satisfies UrlValue;
    const v = value as Record<string, unknown>;
    return {
      text: v.text ? asString(v.text) : '',
      link: v.link ? asString(v.link) : '',
    } satisfies UrlValue;
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 17. 附件 Attachment (type=17)
//     写入: [{file_token}]，支持传 string[]（file_token 数组）自动包装
//     读取: [{file_token,name,type,size,url,tmp_url}] -> AttachmentInfo[]
// ============================================================
export const attachmentAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') return { file_token: item };
        if (item && typeof item === 'object') {
          const v = item as Record<string, unknown>;
          if (v.file_token) return { file_token: asString(v.file_token) };
          if (v.fileToken) return { file_token: asString(v.fileToken) };
        }
        typeError(`附件字段「${fieldDef.fieldName}」数组项必须是 file_token 字符串或 {file_token} 对象`, fieldDef.fieldName);
      });
    }
    typeError(`附件字段「${fieldDef.fieldName}」写入值必须是 [{file_token}]（或 string[]）`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (!Array.isArray(value)) return [];
    return value
      .map((item): AttachmentInfo | null => {
        if (!item || typeof item !== 'object') return null;
        const r = item as Record<string, unknown>;
        if (!r.file_token) return null;
        return {
          fileToken: asString(r.file_token),
          name: r.name ? asString(r.name) : undefined,
          type: r.type ? asString(r.type) : undefined,
          size: typeof r.size === 'number' ? r.size : undefined,
          url: r.url ? asString(r.url) : undefined,
          tmpUrl: r.tmp_url ? asString(r.tmp_url) : undefined,
        };
      })
      .filter((a): a is AttachmentInfo => a !== null);
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 18. 单向关联 SingleLink (type=18) / 21. 双向关联 DuplexLink (type=21)
//     写入: {link_record_ids:[...]}，支持传 string[]（record_id 数组）自动包装
//     读取: {link_record_ids:[...]} -> string[]（提取关联记录 id）
// ============================================================
function linkSerialize(value: unknown, fieldDef: FieldDefinition): unknown {
  if (isNullish(value)) return null;
  // string[]
  if (Array.isArray(value)) {
    return { link_record_ids: value.map((v) => asString(v)) };
  }
  // {link_record_ids} 或 {linkRecordIds}
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const ids = v.link_record_ids ?? v.linkRecordIds;
    if (Array.isArray(ids)) {
      return { link_record_ids: ids.map((id) => asString(id)) };
    }
  }
  typeError(
    `关联字段「${fieldDef.fieldName}」写入值必须是 string[]（关联 record_id 数组）或 {link_record_ids:[...]}`,
    fieldDef.fieldName,
  );
}

function linkDeserialize(value: unknown): string[] | null {
  if (isNullish(value)) return null;
  if (Array.isArray(value)) {
    // 某些情况下飞书可能直接返回 id 数组
    return value.map((v) => (typeof v === 'string' ? v : asString((v as Record<string, unknown>).record_id ?? v)));
  }
  if (value && typeof value === 'object') {
    const ids = (value as Record<string, unknown>).link_record_ids;
    if (Array.isArray(ids)) return ids.map((id) => asString(id));
  }
  return [];
}

export const singleLinkAdapter: FieldAdapter = {
  serialize: linkSerialize,
  deserialize: linkDeserialize,
  isReadOnly: writableIsReadOnly,
};

export const duplexLinkAdapter: FieldAdapter = {
  serialize: linkSerialize,
  deserialize: linkDeserialize,
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 19. 查找引用 Lookup (type=19) / 20. 公式 Formula (type=20)
//     写入: 不可写（抛错）
//     读取: {type, ui_type, value:[]} -> ComputedValue
// ============================================================
function computedDeserialize(value: unknown): ComputedValue | null {
  if (isNullish(value)) return null;
  if (typeof value !== 'object') return { type: 0, uiType: '', value: [] };
  const v = value as Record<string, unknown>;
  return {
    type: typeof v.type === 'number' ? v.type : 0,
    uiType: v.ui_type ? asString(v.ui_type) : '',
    value: Array.isArray(v.value) ? v.value : [],
  };
}

export const lookupAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`查找引用（${fieldDef.fieldName}）`);
  },
  deserialize: computedDeserialize,
  isReadOnly: readonlyIsReadOnly,
};

export const formulaAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`公式（${fieldDef.fieldName}）`);
  },
  deserialize: computedDeserialize,
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 22. 地理位置 Location (type=22)
//     写入: object（飞书地理位置结构）
//     读取: {location,pname,cityname,adname,address,name,full_address} -> LocationValue
// ============================================================
export const locationAdapter: FieldAdapter = {
  serialize(value, fieldDef) {
    if (isNullish(value)) return null;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    typeError(`地理位置字段「${fieldDef.fieldName}」写入值必须是位置对象`, fieldDef.fieldName);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    if (typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    return {
      location: r.location ? asString(r.location) : undefined,
      pname: r.pname ? asString(r.pname) : undefined,
      cityname: r.cityname ? asString(r.cityname) : undefined,
      adname: r.adname ? asString(r.adname) : undefined,
      address: r.address ? asString(r.address) : undefined,
      name: r.name ? asString(r.name) : undefined,
      fullAddress: r.full_address ? asString(r.full_address) : undefined,
    } satisfies LocationValue;
  },
  isReadOnly: writableIsReadOnly,
};

// ============================================================
// 1001. 创建时间 CreatedTime（只读，毫秒戳）
// ============================================================
export const createdTimeAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`创建时间（${fieldDef.fieldName}）`);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return typeof value === 'number' ? value : Number(value);
  },
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 1002. 修改时间 ModifiedTime（只读，毫秒戳）
// ============================================================
export const modifiedTimeAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`修改时间（${fieldDef.fieldName}）`);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return typeof value === 'number' ? value : Number(value);
  },
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 1003. 创建人 CreatedUser（只读，单个 PersonInfo）
// ============================================================
export const createdUserAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`创建人（${fieldDef.fieldName}）`);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return mapPerson(value);
  },
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 1004. 修改人 ModifiedUser（只读，单个 PersonInfo）
// ============================================================
export const modifiedUserAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`修改人（${fieldDef.fieldName}）`);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return mapPerson(value);
  },
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 1005. 自动编号 AutoNumber（只读，string）
// ============================================================
export const autoNumberAdapter: FieldAdapter = {
  serialize(_value, fieldDef) {
    readonlyWriteError(`自动编号（${fieldDef.fieldName}）`);
  },
  deserialize(value) {
    if (isNullish(value)) return null;
    return asString(value);
  },
  isReadOnly: readonlyIsReadOnly,
};

// ============================================================
// 注册表装配：创建内置适配器注册表
// ============================================================

/**
 * 创建一个已注册全部内置字段适配器的注册表实例。
 * 用户可在返回的实例上调用 `register()` 覆盖任意适配器。
 */
export function createDefaultRegistry(): FieldAdapterRegistry {
  const registry = new FieldAdapterRegistry();

  registry.register(FT.Text, textAdapter);
  registry.register(FT.Number, numberAdapter);
  registry.register(FT.SingleSelect, singleSelectAdapter);
  registry.register(FT.MultiSelect, multiSelectAdapter);
  registry.register(FT.DateTime, dateTimeAdapter);
  registry.register(FT.Checkbox, checkboxAdapter);
  registry.register(FT.User, userAdapter);
  registry.register(FT.Phone, phoneAdapter);
  registry.register(FT.Url, urlAdapter);
  registry.register(FT.Attachment, attachmentAdapter);
  registry.register(FT.SingleLink, singleLinkAdapter);
  registry.register(FT.Lookup, lookupAdapter);
  registry.register(FT.Formula, formulaAdapter);
  registry.register(FT.DuplexLink, duplexLinkAdapter);
  registry.register(FT.Location, locationAdapter);
  registry.register(FT.CreatedTime, createdTimeAdapter);
  registry.register(FT.ModifiedTime, modifiedTimeAdapter);
  registry.register(FT.CreatedUser, createdUserAdapter);
  registry.register(FT.ModifiedUser, modifiedUserAdapter);
  registry.register(FT.AutoNumber, autoNumberAdapter);

  return registry;
}

/**
 * 全局默认注册表（单例）。
 * 所有 Schema 默认使用该注册表，除非在构造时传入自定义注册表。
 */
export const defaultRegistry: FieldAdapterRegistry = createDefaultRegistry();
