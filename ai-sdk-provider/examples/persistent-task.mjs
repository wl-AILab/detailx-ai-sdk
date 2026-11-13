import { Pool } from 'pg';
import { PostgresRequestStore } from '@detailx/sdk/postgres';
import { createDetailX } from '@detailx/ai-sdk-provider';

// Call only after your application authenticates the owner and authorizes this order's budget.
export async function startAuthorizedOrder(order) {
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try {
    const provider=createDetailX({store:new PostgresRequestStore(pool)});
    const prepared=await provider.client.prepareGeneration(
      {uploadId:order.uploadId}, {resolution:'4K',fps:-1},
      {requestId:order.id,maxPrechargeCredits:order.maxPrechargeCredits},
    );
    const job=await provider.client.submit(prepared);
    // Store order.ownerId -> job.id in your application DB before returning to the browser.
    return {generationId:job.id,status:job.status};
  } finally {await pool.end();}
}
