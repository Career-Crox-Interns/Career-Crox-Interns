const { table } = require('../lib/store');
const { containsText, normalizeIndianPhone } = require('../lib/helpers');

async function search(req, res) {
  const q = String(req.query.q || '').toLowerCase();
  const phoneQ = normalizeIndianPhone(q);
  const candidates = (await table('candidates'))
    .filter((row) => ['candidate_id', 'full_name', 'phone', 'process'].some((key) => containsText(row[key], q)) || (phoneQ && normalizeIndianPhone(row.phone || '').includes(phoneQ)))
    .slice(0, 20);
  const tasks = (await table('tasks'))
    .filter((row) => ['task_id', 'title', 'description', 'assigned_to_name'].some((key) => containsText(row[key], q)))
    .slice(0, 20);
  const jds = (await table('jd_master'))
    .filter((row) => ['jd_id', 'job_title', 'company', 'location'].some((key) => containsText(row[key], q)))
    .slice(0, 20);
  return res.json({ candidates, tasks, jds });
}

module.exports = {
  search,
};
