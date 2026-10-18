export function validateContact({ name, email, message }) {
  const errors = {};
  if (!name.trim()) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email.";
  if (message.trim().length < 10) errors.message = "Write at least 10 characters.";
  return errors;
}
