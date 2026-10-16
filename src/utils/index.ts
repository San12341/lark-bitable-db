/**
 * 工具函数集合
 */

/**
 * 延迟指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数退避 + 抖动计算等待时间
 *
 * @param attempt 当前重试次数（从 1 开始）
 * @param baseDelay 基础延迟（毫秒），默认 100
 * @param maxDelay 最大延迟（毫秒），默认 10000
 */
export function exponentialBackoff(
  attempt: number,
  baseDelay: number = 100,
  maxDelay: number = 10000,
): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // 添加 ±20% 抖动
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
}

/**
 * 单飞模式（single-flight）：并发调用同一异步函数时只执行一次
 *
 * @param key 函数标识
 * @param fn 异步函数
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) {
    return inFlight.get(key) as Promise<T>;
  }
  const promise = fn()
    .then((result) => {
      inFlight.delete(key);
      return result;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });
  inFlight.set(key, promise);
  return promise;
}

/**
 * 将 Date 对象或毫秒时间戳统一转为毫秒时间戳
 */
export function toMilliseconds(value: Date | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  return value;
}

/**
 * 将毫秒时间戳转为 Date 对象
 */
export function toDate(value: number): Date {
  return new Date(value);
}

/**
 * 从富文本数组中提取纯文本
 * 飞书文本字段读取格式：[{text: "xxx", type: "text"}, ...]
 */
export function extractTextFromRichText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 从邮箱富文本中提取邮箱地址
 * 格式：[{text: "xxx", link: "mailto:xxx@xx.com", type: "url"}]
 */
export function extractEmail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first === 'object') {
      const link = (first as { link?: string }).link;
      if (link?.startsWith('mailto:')) {
        return link.slice(7);
      }
      if ((first as { text?: string }).text) {
        return String((first as { text: string }).text);
      }
    }
  }
  return '';
}

/**
 * 深拷贝（JSON 方式，适用于纯数据对象）
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * 检查值是否为空（null/undefined/空字符串/空数组）
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * 按表 ID 管理写锁（用于同表写操作串行化）
 */
export class TableWriteLock {
  private locks = new Map<string, Promise<void>>();

  /**
   * 获取表写锁，返回释放函数。
   *
   * 实现要点：把「前驱链」和「自己的释放信号」链接为同一个 Promise 存入 map。
   * 这样后继者 await 的正是「自己被释放」的时刻（真正互斥），且 release 时
   * 的引用比较必然成立（可清理）；仅当队尾仍是自己时才删除，避免误删后继者。
   */
  async acquire(tableId: string): Promise<() => void> {
    let release!: () => void;
    const own = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.locks.get(tableId) ?? Promise.resolve();
    const chained = previous.then(() => own);
    this.locks.set(tableId, chained);

    // 等待前驱完成；自己是第一个持锁者则立即通过
    await previous;

    let released = false;
    return () => {
      // release 幂等：防止重复调用破坏串行性
      if (released) return;
      released = true;
      release();
      // 仅当队尾仍是自己时才清理，避免误删后继者的锁
      if (this.locks.get(tableId) === chained) {
        this.locks.delete(tableId);
      }
    };
  }
}

/**
 * 生成简单的请求 ID（用于日志追踪）
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 断言条件，不满足时抛出错误
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
