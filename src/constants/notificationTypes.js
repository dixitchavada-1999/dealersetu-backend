const NOTIFICATION_TYPES = {
    ORDER_PLACED: 'order_placed',
    ORDER_APPROVED: 'order_approved',
    ORDER_DISPATCHED: 'order_dispatched',
    ORDER_DELIVERED: 'order_delivered',
    ORDER_CANCELLED: 'order_cancelled',
    PAYMENT_RECEIVED: 'payment_received',
    PAYMENT_PENDING: 'payment_pending',
    NEW_CUSTOMER: 'new_customer',
    LOW_STOCK: 'low_stock',
    STOCK_UPDATED: 'stock_updated',
    WELCOME: 'welcome',
    FEEDBACK_RECEIVED: 'feedback_received',
    DISCOUNT_UPDATED: 'discount_updated',
    VISIT_CREATED: 'visit_created',
    VISIT_APPROVED: 'visit_approved',
    VISIT_REJECTED: 'visit_rejected',
    CUSTOMER_DEACTIVATED: 'customer_deactivated',
};

const NOTIFICATION_TYPE_VALUES = Object.values(NOTIFICATION_TYPES);

module.exports = { NOTIFICATION_TYPES, NOTIFICATION_TYPE_VALUES };
