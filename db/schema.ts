import { pgTable, text, timestamp, date, jsonb } from "drizzle-orm/pg-core";

export const investors = pgTable("investors", {
  id: text().primaryKey(),
  firm: text().notNull().default(""),
  contact: text().notNull().default(""),
  email: text().notNull().default(""),
  website: text().notNull().default(""),
  linkedin: text().notNull().default(""),
  status: text().notNull().default("new"),
  nda: text().notNull().default("none"),
  checkSize: text("check_size").notNull().default(""),
  owner: text().notNull().default(""),
  stage: text().notNull().default(""),
  thesis: text().notNull().default(""),
  notes: text().notNull().default(""),
  timeline: jsonb().$type<Array<{ date: string; note: string }>>().notNull().default([]),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  lastContact: date("last_contact"),
  nextMeeting: date("next_meeting"),
  profiledAt: timestamp("profiled_at", { mode: "string" }),
});
