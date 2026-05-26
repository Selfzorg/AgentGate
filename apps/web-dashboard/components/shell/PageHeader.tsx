export function PageHeader({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-7 max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-normal text-foreground">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
