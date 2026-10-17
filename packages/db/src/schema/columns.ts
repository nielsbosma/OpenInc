import { bigint, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pk = () => uuid().primaryKey().defaultRandom();

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz().notNull().defaultNow();

export const updatedAt = () =>
  timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Money in the currency's minor units (cents, öre). Never floats. */
export const minorUnits = () => bigint({ mode: 'bigint' });

/** A number of shares. */
export const shareCount = () => bigint({ mode: 'bigint' });

/** Price per share, with more precision than the currency's minor unit. */
export const pricePerShare = () => numeric({ precision: 24, scale: 10 });

/** Percentages and ratios, e.g. 12.345678. */
export const percentage = () => numeric({ precision: 9, scale: 6 });
