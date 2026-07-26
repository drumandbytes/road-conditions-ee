import { getAdminDbOverview, getAdminStats, getAdminUserCount, getAdminUsers } from "../db";

export async function handleAdminStats(db: D1Database): Promise<Response> {
  const stats = await getAdminStats(db);
  return Response.json(stats);
}

export async function handleAdminDb(db: D1Database): Promise<Response> {
  const overview = await getAdminDbOverview(db);
  return Response.json(overview);
}

const USERS_PAGE_SIZE = 50;

export async function handleAdminUsers(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const offset = (page - 1) * USERS_PAGE_SIZE;

  const [users, total] = await Promise.all([getAdminUsers(db, USERS_PAGE_SIZE, offset), getAdminUserCount(db)]);
  return Response.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      subscriptionStatus: u.subscription_status,
      createdAt: u.created_at,
      savedPointCount: u.saved_point_count,
    })),
    page,
    pageSize: USERS_PAGE_SIZE,
    total,
  });
}
