export type Note = {
  id: number;
  title: string;
  done: boolean;
  // ISO 8601, in UTC.
  createdAt: string;
};
