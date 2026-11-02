/** Every object one render stores: the file and its gallery thumbnail (earlier templates kept a `.preview.png`). */
export function promotionArtifactKeys(key: string) {
  return [key, promotionThumbnailKey(key), `${key}.preview.png`];
}
export function promotionThumbnailKey(key: string) {
  return `${key}.thumb`;
}
