import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

export const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  phone: optionalText(40),
  smsConsent: z.boolean().optional().default(false),
  projectType: z.string().trim().min(2).max(120),
  propertyAddress: z.string().trim().min(5).max(300),
  preferredMeeting: optionalText(100),
  idealStart: optionalText(100),
  message: z.string().trim().min(10).max(4000),
});

export const jobPositions = ['Restoration Carpenter', 'Drywall Finisher', 'Site Supervisor', 'Project Manager', 'Other'] as const;
export const maxResumeBytes = 5 * 1024 * 1024;

export const applicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  phone: optionalText(40),
  position: z.enum(jobPositions),
  message: z.string().trim().max(4000).optional().default(''),
  resume: z.object({
    name: z.string().trim().min(1).max(200),
    // Base64 of a PDF no larger than maxResumeBytes.
    data: z.string().max(Math.ceil(maxResumeBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }).optional(),
});

export const applicationStatusSchema = z.object({
  status: z.enum(['new', 'reviewed', 'contacted', 'rejected']),
});

export const verifyRequestSchema = z.object({
  token: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

export const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4000).optional().default(''),
  page: z.string().max(300).optional().default(''),
});

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/),
  password: z.string().min(1).max(200),
});

export const statusSchema = z.object({
  status: z.enum(['new', 'contacted', 'scheduled', 'in_progress', 'declined']),
});

export const quoteApprovalSchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']),
});

export const paymentSchema = z.object({
  amount: z.number().finite().positive().max(10000000),
  note: z.string().trim().max(300).optional().default(''),
  kind: z.enum(['payment', 'refund']).optional().default('payment'),
});

export const voidSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const expenseCategories = ['payroll', 'subcontractor', 'materials', 'equipment', 'vehicle', 'office', 'insurance', 'other'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

export const expenseSchema = z.object({
  expenseDate: isoDate,
  category: z.enum(expenseCategories),
  description: z.string().trim().min(2).max(200),
  paidTo: z.string().trim().max(120).optional().default(''),
  amount: z.number().finite().positive().max(10000000),
  requestId: z.union([z.uuid(), z.literal('')]).optional().default(''),
});

export const meetingStatuses = ['scheduled', 'postponed', 'done', 'cancelled'] as const;
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const meetingUpdateSchema = z.object({
  // Same format the contact form sends (datetime-local), a plain date, or empty to clear it.
  preferredMeeting: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/), z.literal('')]),
  meetingStatus: z.enum(meetingStatuses),
  meetingNote: z.string().trim().max(500).optional().default(''),
});

export const calendarEventSchema = z.object({
  title: z.string().trim().min(2).max(160),
  eventDate: isoDate,
  startTime: z.union([clockTime, z.literal('')]).optional().default(''),
  kind: z.enum(['site_meeting', 'job', 'delivery', 'inspection', 'other']),
  status: z.enum(meetingStatuses).optional().default('scheduled'),
  note: z.string().trim().max(1000).optional().default(''),
  requestId: z.union([z.uuid(), z.literal('')]).optional().default(''),
});

export const financeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const materialSchema = z.object({
  name: z.string().trim().min(2).max(180),
  category: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(40),
  unitPrice: z.number().finite().nonnegative().max(10000000),
  supplier: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().max(80).optional().default(''),
  stockQty: z.number().finite().nonnegative().max(1000000).optional().default(0),
  priceSource: z.enum(['manual', 'invoice', 'csv', 'supplier_api']).default('manual'),
  supplierUrl: z.union([z.url(), z.literal('')]).optional().default(''),
  supplierStore: z.string().trim().max(160).optional().default(''),
  // Absolute image URL, or a thumbnail saved with the site under /assets/.
  imageUrl: z.union([z.url(), z.literal(''), z.string().regex(/^\/assets\/[\w./ -]+$/).refine((path) => !path.includes('..'))]).optional().default(''),
});

export const materialUpdateSchema = materialSchema.omit({ stockQty: true });

export const inventoryMovementSchema = z.object({
  materialId: z.uuid(),
  quantityChange: z.number().finite().refine((value) => value !== 0, 'Quantity change cannot be zero.').max(1000000).min(-1000000),
  note: z.string().trim().min(3).max(300),
  expectedStock: z.number().finite().nonnegative().optional(),
});

export const materialFollowupSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(2).max(180),
    quantity: z.number().finite().positive().max(100000),
    unit: z.string().trim().min(1).max(40),
  })).min(1).max(20),
  message: z.string().trim().max(2000).optional().default(''),
});

export const quoteSchema = z.object({
  lines: z.array(z.object({
    type: z.enum(['material', 'labor', 'other']),
    materialId: z.uuid().optional(),
    description: z.string().trim().min(2).max(180),
    quantity: z.number().finite().positive().max(100000),
    unit: z.string().trim().min(1).max(40),
    unitCost: z.number().finite().nonnegative().max(10000000),
  })).min(1).max(40),
  marginPercent: z.number().finite().min(0).max(80).default(25),
  taxPercent: z.number().finite().min(0).max(20).default(0),
  note: z.string().trim().max(2000).optional().default(''),
  senderName: z.string().trim().max(80).optional().default(''),
});

export type ProjectRequestInput = z.infer<typeof requestSchema>;
export type MaterialInput = z.infer<typeof materialSchema>;
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;
