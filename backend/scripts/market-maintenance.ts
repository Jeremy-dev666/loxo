/**
 * Marketplace maintenance, run by operators (npm run market:maintain):
 * removes listings whose source files vanished and warms the avatar cache.
 * Deliberately a script, not an HTTP endpoint — there is no admin role.
 */
import { closeDb, db } from '../src/db/client';
import { marketListings } from '../src/db/schema';
import { cacheListingAvatar } from '../src/modules/market/avatar-cache';
import { removeBrokenListings } from '../src/modules/market/market.service';

const { removed } = await removeBrokenListings();
console.log(`Removed ${removed} broken listing(s)`);

let warmed = 0;
for (const listing of await db.select().from(marketListings)) {
  if (listing.avatarSource && (await cacheListingAvatar(listing.id, listing.avatarSource))) {
    warmed += 1;
  }
}
console.log(`Avatar cache warm: ${warmed} cached`);

await closeDb();
