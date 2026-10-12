import { uuid, boolean, varchar, pgTable, pgEnum, timestamp } from "drizzle-orm/pg-core";

export const accountType = pgEnum('account_type', ['business', 'customer'])


export const Account = pgTable('account_records', {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: varchar('business_name', { length: 500 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  account_type: accountType('account_type').default('customer'),
  phoneNumber: varchar('phone_number', { length: 255 }),
  password: varchar('password', { length: 255 }).unique().notNull(),
  lastLogin: timestamp("last_login"),
  isActive: boolean('is_active').default(true),
  kycStatus: boolean('kyc_status').default(false),
  isVerified: boolean('is_verified').default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
})