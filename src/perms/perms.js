const grantBtn = document.getElementById('grant');
const laterBtn = document.getElementById('later');
const closeBtn = document.getElementById('close');

function grant() {
  window.api.send('perms:grant');
  window.close();
}

function later() {
  window.close();
}

grantBtn.addEventListener('click', grant);
laterBtn.addEventListener('click', later);
closeBtn.addEventListener('click', later);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
  if (e.key === 'Enter') grant();
});
