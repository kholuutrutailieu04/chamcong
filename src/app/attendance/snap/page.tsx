import { redirect } from 'next/navigation';

export default async function AttendanceSnapRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) {
    redirect('/check-in');
  }

  redirect(`/check-in/random/${encodeURIComponent(token)}`);
}
