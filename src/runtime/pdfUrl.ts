/** PDF URLs (http, https, file), with an optional query or fragment. */
export const isPdfLike = (url: string | undefined): boolean =>
  !!url && /^(https?|file):\/\/.+\.pdf(\?.*)?(#.*)?$/i.test(url);
