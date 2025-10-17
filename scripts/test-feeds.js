const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const membersDir = path.join(__dirname, '../data/members');
const report = [];

async function checkFeed(url) {
    try {
        const response = await axios.get(url, { timeout: 5000 });
        const contentType = response.headers['content-type'];

        if (!contentType.includes('xml')) {
            report.push({ url, status: 'Invalid Content Type', contentType });
            return;
        }

        await parseStringPromise(response.data);
        report.push({ url, status: 'Valid Feed' });
    } catch (error) {
        if (error.response) {
            report.push({ url, status: 'Invalid Feed', statusCode: error.response.status });
        } else if (error.code === 'ECONNABORTED') {
            report.push({ url, status: 'Timed Out' });
        } else {
            report.push({ url, status: 'Error', message: error.message });
        }
    }
}

async function testFeeds() {
    const files = fs.readdirSync(membersDir).filter(file => file.endsWith('.yaml'));
    
    for (const file of files) {
        const filePath = path.join(membersDir, file);
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const memberData = yaml.load(fileContents);

        if (memberData.blogFeed) {
            await checkFeed(memberData.blogFeed);
        }
    }

    console.log('Feed Test Report:', report);
}

testFeeds();
