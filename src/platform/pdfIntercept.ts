/**
 * Optional interception (§8.1, off by default): redirects top-level .pdf navigations to the reader
 * with a declarativeNetRequest rule.
 */
import { browser } from 'wxt/browser';

const RULE_ID = 1;

export async function setPdfInterception(on: boolean): Promise<void> {
  const reader = browser.runtime.getURL('/reader.html');
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: on
      ? [
          {
            id: RULE_ID,
            priority: 1,
            action: { type: 'redirect', redirect: { regexSubstitution: `${reader}?src=\\0` } },
            condition: {
              regexFilter: '^https?://[^#]*\\.pdf(\\?[^#]*)?$',
              resourceTypes: ['main_frame'],
            },
          },
        ]
      : [],
  });
}
