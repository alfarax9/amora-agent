export function toggleFaq(open, index) {
  return open.map((flag, position) => (position === index ? !flag : flag));
}
