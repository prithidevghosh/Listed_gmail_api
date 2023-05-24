

const axios = require('axios');
require('dotenv').config();
const { client_secret, client_id, redirect_uris, refresh_token, gmail_user } = process.env;

console.log(client_id);
// Set up OAuth 2.0 credentials
const clientId = client_id;
const clientSecret = client_secret;
const refreshToken = refresh_token;

// Store the processed thread IDs
const processedThreads = [];

async function checkNewEmails() {
    try {
        // Get access token using refresh token
        const { data } = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });
        console.log(data);
        const accessToken = data.access_token;

        // Make API request to get new unread emails
        const { data: messagesData } = await axios.get(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is%3Aunread`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const messages = messagesData.messages || [];
        if (messages.length === 0) {
            console.log('No new unread emails.');
            return;
        }

        console.log('New unread emails:');

        for (const message of messages) {
            const { data: threadData } = await axios.get(
                `https://gmail.googleapis.com/gmail/v1/users/me/threads/${message.threadId}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            const thread = threadData.messages || [];
            const sender = thread[0].payload.headers.find(
                (header) => header.name === 'From'
            ).value;

            const threadId = thread[0].threadId;

            // Skip the thread if it has already been processed
            if (processedThreads.includes(threadId)) {
                console.log('Skipping already processed thread:', threadId);
                continue;
            }

            // Check if the email thread has no prior replies and subject doesn't contain "Re: Out of Office Auto Reply"
            const hasReplies = thread.some((msg) =>
                msg.payload.headers.some(
                    (header) =>
                        header.name === 'From' && header.value === ''
                )
            );

            const subject = thread[0].payload.headers.find(
                (header) => header.name === 'Subject'
            ).value;

            if (!hasReplies && !subject.includes('Re: Out of Office Auto Reply')) {
                console.log('- Message ID:', message.id);
                console.log('  Sender:', sender);

                // Send reply
                const replyMessage = {
                    to: sender,
                    subject: 'Re: Out of Office Auto Reply',
                    message: 'Thank you for your email. I am currently on vacation and will reply to your message when I return.'
                };
                await sendReply(replyMessage, accessToken);

                // Add label and move email
                const labelName = 'Vacation Reply';
                await addLabelToEmail(message.id, labelName, accessToken);

                console.log('Reply sent and label added to the email.');

                // Mark the thread as processed
                processedThreads.push(threadId);
            }
        }
    } catch (error) {
        console.error('Error checking new emails:', error.message);
    }
}

async function sendReply(replyMessage, accessToken) {
    const { to, subject, message } = replyMessage;

    const rawMessage = [
        'Content-Type: text/plain; charset=utf-8',
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        message
    ].join('\n');

    const { data: sentMessage } = await axios.post(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
        {
            raw: Buffer.from(rawMessage).toString('base64')
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const threadId = sentMessage.threadId;
    await markThreadAsRead(threadId, accessToken);
}

async function markThreadAsRead(threadId, accessToken) {
    try {
        await axios.post(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
            {
                removeLabelIds: ['UNREAD']
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {
        console.error('Error marking thread as read:', error.message);
    }
}

async function addLabelToEmail(messageId, labelName, accessToken) {
    try {
        // Check if the label exists
        const { data: labelsData } = await axios.get(
            `https://gmail.googleapis.com/gmail/v1/users/me/labels`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const labels = labelsData.labels || [];
        let label = labels.find((label) => label.name === labelName);

        if (!label) {
            // Create the label if it doesn't exist
            const { data: createdLabel } = await axios.post(
                `https://gmail.googleapis.com/gmail/v1/users/me/labels`,
                {
                    name: labelName,
                    labelListVisibility: 'labelShow',
                    messageListVisibility: 'show'
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            label = createdLabel;
            console.log('Label created:', label);
        }

        // Add the label to the email
        await axios.post(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
            {
                addLabelIds: [label.id]
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {
        console.error('Error adding label to email:', error.message);
    }
}
const MIN_INTERVAL = 45000; // 45 seconds
const MAX_INTERVAL = 120000; // 120 seconds
function getRandomInterval() {
    return Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
}


async function runAutoReply() {
    while (true) {
        await checkNewEmails();
        const interval = getRandomInterval();
        await sleep(interval);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

runAutoReply().catch(console.error);
// Call the function to check for new emails

