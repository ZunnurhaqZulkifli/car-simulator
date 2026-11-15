// probe.mjs steps for a load test of any car on the live drive.html: the credit line (it names the model that loaded),
// the car page's title, and a chase shot. Console warnings / errors (a model that failed to load warns) are counted by probe.mjs
export default async ({ shot, ev }) => {
  await shot('chase');
  return ev(`({ credit: document.getElementById('credit').textContent.split('·')[0].trim(), page: document.getElementById('carpage').contentDocument.title, canvas: !!document.querySelector('canvas') })`);
};
