// Pool selection dots size & state test
// Ensures edit pool checkboxes/radios match chain station dots and have proper state distinction

export async function run(page) {
  await page.goto('http://localhost:1440/chain-dots.html');
  await page.waitForSelector('.chain-station-dot', { timeout: 5000 });
  
  // Measure reference: chain station dot
  const refDot = page.locator('.chain-station-dot').first();
  const refRect = await refDot.boundingBox();
  const refW = Math.round(refRect.width);
  const refH = Math.round(refRect.height);
  
  // Measure checkbox (specified nodes mode)
  const checkboxDot = page.locator('.chain-pool-select-dot[type="checkbox"]').first();
  const checkboxRect = await checkboxDot.boundingBox();
  const cbW = Math.round(checkboxRect.width);
  const cbH = Math.round(checkboxRect.height);
  
  // Measure radio (subscription mode)
  const radioDot = page.locator('.chain-pool-select-dot[type="radio"]').first();
  const radioRect = await radioDot.boundingBox();
  const radioW = Math.round(radioRect.width);
  const radioH = Math.round(radioRect.height);
  
  // Assert size equality
  if (cbW !== refW || cbH !== refH) {
    throw new Error(`Checkbox dot size mismatch: expected ${refW}×${refH}, got ${cbW}×${cbH}`);
  }
  if (radioW !== refW || radioH !== refH) {
    throw new Error(`Radio dot size mismatch: expected ${refW}×${refH}, got ${radioW}×${radioH}`);
  }
  
  // Measure ::before pseudo-element styles
  const uncheckedCheckbox = await checkboxDot.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, '::before');
    return beforeStyle.backgroundColor;
  });
  
  const checkedCheckbox = page.locator('.chain-pool-select-dot[type="checkbox"]:checked');
  const checkedCheckboxBg = await checkedCheckbox.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, '::before');
    return beforeStyle.backgroundColor;
  });
  
  const uncheckedRadio = await radioDot.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, '::before');
    return beforeStyle.backgroundColor;
  });
  
  const checkedRadio = page.locator('.chain-pool-select-dot[type="radio"]:checked');
  const checkedRadioBg = await checkedRadio.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, '::before');
    return beforeStyle.backgroundColor;
  });
  
  // Assert state distinction
  if (uncheckedCheckbox === checkedCheckboxBg) {
    throw new Error(`Checkbox state indistinguishable: both ${uncheckedCheckbox}`);
  }
  if (uncheckedRadio === checkedRadioBg) {
    throw new Error(`Radio state indistinguishable: both ${uncheckedRadio}`);
  }
  
  console.log(`✓ Pool dots size: ${refW}×${refH} (ref=${refW}×${refH}, checkbox=${cbW}×${cbH}, radio=${radioW}×${radioH})`);
  console.log(`✓ Checkbox state: unchecked=${uncheckedCheckbox}, checked=${checkedCheckboxBg}`);
  console.log(`✓ Radio state: unchecked=${uncheckedRadio}, checked=${checkedRadioBg}`);
}
