import { searchGuides } from '../data/help';

// The offline answer to the staff bot's own suggested questions must name the right page.
test.each([
  ['Where do I create or edit a deposit plan?', 'bank_owner', 'Scheme Master'],
  ['How do I book an FD or RD for a member?', 'staff', 'Book Member Deposit'],
  ['Where do I see the NDH return figures?', 'bank_owner', 'Reports'],
])('%s', (question, role, page) => {
  expect(searchGuides(question, role, []).split('\n')[0]).toContain(page);
});
