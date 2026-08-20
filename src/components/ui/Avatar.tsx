export function Avatar({ name, url, size }: { name: string | null | undefined; url?: string | null; size?: "lg" }) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <span className={`avatar ${size ?? ""}`} title={name ?? undefined}>
      {url ? <img src={url} alt="" /> : initial}
    </span>
  );
}
