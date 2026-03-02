export async function uploadWorkingPaper(taskId: string, file: File) {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Upload failed (${res.status})`);
  }

  return data;
}
