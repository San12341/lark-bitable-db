/**
 * 进阶示例：自动分页、批量操作、复杂查询、异常处理、Webhook 验签
 *
 * 运行前请设置环境变量（同 basic.ts）。
 */

import {
  BitableClient,
  Model,
  Schema,
  FieldType,
  BitableNotFoundError,
  BitableRateLimitError,
  BitableAuthError,
  parseWebhookEvent,
  type BitableWebhookEvent,
} from '../src';

// ============================================================
// 1. 定义订单表
// ============================================================
type OrderRow = {
  orderNo: string;
  amount: number;
  status: string;
  city: string;
  customer: string;
};

const orderSchema = new Schema({
  orderNo:  { fieldName: '订单号', type: FieldType.Text },
  amount:   { fieldName: '金额', type: FieldType.Number },
  status:   { fieldName: '状态', type: FieldType.SingleSelect },
  city:     { fieldName: '城市', type: FieldType.Text },
  customer: { fieldName: '客户', type: FieldType.Text },
});

class OrderModel extends Model<OrderRow> {
  static tableId = process.env.TABLE_ID!;
  static schema = orderSchema;
}

async function main() {
  const client = new BitableClient({
    appId: process.env.APP_ID!,
    appSecret: process.env.APP_SECRET!,
    appToken: process.env.APP_TOKEN!,
  });
  const orders = new OrderModel(client);

  // ============================================================
  // 2. 批量创建（自动分批：超过 1000 条自动拆分）
  // ============================================================
  const bulkOrders: OrderRow[] = Array.from({ length: 1500 }, (_, i) => ({
    orderNo: `ORD-${String(i + 1).padStart(6, '0')}`,
    amount: 100 + i,
    status: 'pending',
    city: i % 2 === 0 ? '广州' : '深圳',
    customer: `Customer-${i}`,
  }));
  const created = await orders.query().createMany(bulkOrders);
  console.log(`Batch created ${created.length} orders`);

  // ============================================================
  // 3. 复杂查询：AND + OR 分组 + 多字段排序
  //    语义：(status = 'paid' OR status = 'shipped') AND city = '广州'
  // ============================================================
  const paidInGuangzhou = await orders
    .query()
    .where('city', '=', '广州')
    .or((sub) => {
      sub.where('status', '=', 'paid').where('status', '=', 'shipped');
    })
    .orderBy('amount', 'desc')
    .orderBy('orderNo', 'asc')
    .findAll();
  console.log(`Paid/shipped in Guangzhou: ${paidInGuangzhou.length}`);

  // ============================================================
  // 4. 自动分页：findAll 自动循环 page_token
  // ============================================================
  const allOrders = await orders.query().where('status', '=', 'pending').findAll();
  console.log(`All pending orders: ${allOrders.length}`);

  // ============================================================
  // 5. 异常处理
  // ============================================================
  try {
    await orders.query().findById('rec_nonexistent');
  } catch (err) {
    if (err instanceof BitableNotFoundError) {
      console.log('Record not found:', err.message, '(resourceType:', err.resourceType + ')');
    } else if (err instanceof BitableRateLimitError) {
      console.log(`Rate limited, retry after ${err.retryAfter}s`);
    } else if (err instanceof BitableAuthError) {
      console.log('Auth failed — check appId/appSecret');
    } else {
      throw err;
    }
  }

  // ============================================================
  // 6. 批量更新 + 批量删除
  // ============================================================
  await orders.query().updateMany(
    created.slice(0, 10).map((o) => ({
      recordId: o.recordId,
      data: { status: 'cancelled' as string },
    })),
  );

  await orders.query().deleteMany(created.slice(0, 10).map((o) => o.recordId));
  console.log('Cleaned up 10 orders');
}

// ============================================================
// 7. Webhook 验签示例（Express/Koa 中间件）
// ============================================================
async function handleWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
) {
  const event = parseWebhookEvent(rawBody, headers, {
    encryptKey: process.env.WEBHOOK_ENCRYPT_KEY!,
    verificationToken: process.env.WEBHOOK_VERIFICATION_TOKEN,
  });

  // URL 验证挑战
  if ('challenge' in event) {
    console.log('Challenge:', event.challenge);
    return event;
  }

  // 业务事件
  const bitableEvent = event as BitableWebhookEvent;
  console.log('Received event:', bitableEvent.header.eventType);
  console.log('Table:', bitableEvent.event.tableId);
  return { received: true };
}

// main();
