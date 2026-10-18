// A test reporter for CI: each failing test becomes a GitHub annotation, which
// anyone can read on the run's checks. The job log itself needs a signed-in
// admin, so without this a failure on one platform says only "exit code 1".

type TestEvent = {
  type: string;
  data: {
    name?: string;
    file?: string;
    line?: number;
    details?: { error?: { message?: string; cause?: { message?: string } } };
  };
};

// Workflow commands end at a newline and treat % specially; properties also
// stop at commas and colons.
const escapeData = (text: string) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text: string) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

function annotation({ name = "test", file = "", line = 1, details }: TestEvent["data"]): string {
  const error = details?.error;
  const message = (error?.cause?.message ?? error?.message ?? "failed").slice(0, 2000);
  const where = `file=${escapeProperty(file)},line=${line},title=${escapeProperty(name)}`;
  return `::error ${where}::${escapeData(message)}\n`;
}

export default async function* githubAnnotations(source: AsyncIterable<TestEvent>) {
  for await (const event of source) {
    if (event.type === "test:fail") yield annotation(event.data);
  }
}
