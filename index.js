const express = require('express')

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

const app = express();

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://mail.google.com/',
];


app.get('/', async(req, res) => {

    
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    // console.log(client)
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}


async function listLabels(auth) {
//   console.log(auth)
  const gmail = google.gmail({version: 'v1', auth});
  const res = await gmail.users.labels.list({
    userId: 'me',
  });
  const labels = res.data.labels;
  if (!labels || labels.length === 0) {
    console.log('No labels found.');
    return;
  }
  console.log('Labels:');
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}






const LABEL = 'auto-replied'

const createLabel = async (auth) => {
    console.log(auth)
    const gmail = google.gmail({version: 'v1', auth});
    try {
        const label = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: LABEL,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            }
        })
        return label.data.id;
    }
    catch (error) {
        if (error.code === 409) {
            console.log('label already created')

            const res = await gmail.users.labels.list({
              userId: 'me',
            })

            const label = res.data.labels.find(label => label.name === LABEL);
            console.log(label.id)
            return label.id
        }
        else throw error;
    }
}



const getUnreadMails = async(auth) => {
    const gmail = google.gmail({version: 'v1', auth});

    const unread_mails = await gmail.users.messages.list({
        userId: 'me',
        q: `-from:me -has:userlabels`
    });

    if (!unread_mails.data.messages) return []

    return unread_mails.data.messages;
}


const autoReply = async(auth, mail) =>  {
    const gmail = google.gmail({version: 'v1', auth});
    const _mail = await gmail.users.messages.get({
        userId: 'me',
        id: mail.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
    });

    const subject = _mail.data.payload.headers.find((header) => header.name === 'Subject').value;
    const from = _mail.data.payload.headers.find((header) => header.name === 'From').value;
    const match = from.match(/<(.*)>/);
    const fromEmailAddress = match[1];


    const replyPayload = [
        `From: me`,
        `To: ${fromEmailAddress}`,
        `Subject: auto-reply`,
        `In-Reply-To: ${mail.id}`,
        '',
        `This is auto generated email. I am on vacations. I'll get back to you ASAP.`,
    ].join('\n')

    const raw = Buffer.from(replyPayload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    
    await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: raw,
        },
    });
}


const markReplied = async(auth, mail, labelid) => {
    const gmail = google.gmail({version: 'v1', auth});

    // const _mail = await gmail.users.messages.get({
    //     userId: 'me',
    //     id: mail.id,
    //     format: 'metadata',
    //     metadataHeaders: ['Subject', 'From'],
    // });

    await gmail.users.messages.modify({
        userId: 'me',
        id: mail.id,
        requestBody: {
            addLabelIds: [labelid],
            removeLabelIds: ['INBOX']
        }
    })
}

const bot = async(auth) => {
    const labelid = await createLabel(auth);

    setInterval(async(auth) => {
        const unread_mails = await getUnreadMails(auth);
    
        for (let mail of unread_mails) {
            await autoReply(auth, mail);
            await markReplied(auth, mail, labelid);
        }
    
    }, 90000, auth);
}


// authorize().then(listLabels).catch(console.error);
authorize().then(bot).catch(console.error);

})


app.listen(3000, () => {console.log('started.....')});