const axios = require('axios');
require('dotenv').config();

const { client_secret, client_id, redirect_uris, refresh_token, gmail_user } = process.env;

// Set up OAuth 2.0 credentials
const clientId = client_id;
const clientSecret = client_secret;
const refreshToken = refresh_token;

// Store the processed thread IDs
let processedThreads = [];

async function checkNewEmails() {
    try {
        // Get access token using refresh token
        const { data } = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });
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
            console.log(message.id);
            const { data: threadData } = await axios.get(
                `https://gmail.googleapis.com/gmail/v1/users/me/threads/${message.threadId}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            const senders = threadData.messages.map((message) =>
                message.payload.headers.find((header) => header.name === 'From').value
            );

            for (let sender of senders) {
                if (sender === gmail_user) {
                    console.log("Same as owner, skipping...");
                    continue;
                } else {
                    console.log('- Message ID:', message.id);
                    console.log('  Sender:', sender);

                    const originalSubject = threadData.messages[0].payload.headers.find(header => header.name === 'Subject').value;


                    // Get the Message-ID of the original email
                    const originalMessageIdHeader = threadData.messages[0].payload.headers.find(
                        (header) => header.name === 'Message-ID'
                    );

                    // Check if the original email has a Message-ID header
                    if (!originalMessageIdHeader) {
                        console.log('Original email does not have a Message-ID header');
                        continue;
                    }

                    const originalMessageId = originalMessageIdHeader.value;

                    // Send reply
                    const replyMessage = {
                        to: sender,
                        subject: originalSubject,
                        threadIdSending: threadData.id,
                        messageId: message.id,
                        originalMessageId: originalMessageId,
                        message:
                            'Thank you for your email. I am currently on vacation and will reply to your message when I return.',
                    };

                    await sendReply(replyMessage, accessToken);

                    console.log('Reply sent.');

                    // Mark the thread as processed
                    processedThreads.push(threadData.id);
                }
            }
        }
    } catch (error) {
        console.error('Error checking new emails:', error.message);
        console.error(error.response.data);
    }
}

async function sendReply(replyMessage, accessToken) {
    const { to, subject, threadIdSending, messageId, originalMessageId, message } =
        replyMessage;
    const replySubject = `Re: ${subject}`;
    const replyBody = message;
    const replyEmail = {
        raw: Buffer.from(
            `To: ${to}\r\n` +
            `Subject: ${replySubject}\r\n` +
            `In-Reply-To: ${originalMessageId}\r\n` +
            `References: ${originalMessageId}\r\n` +
            `Message-ID: ${messageId}\r\n` +
            '\r\n' +
            `${replyBody}`
        ).toString('base64'),
    };

    try {
        const { data } = await axios.post(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
            { raw: replyEmail.raw, threadId: threadIdSending },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        console.log('Reply sent successfully!');
        console.log('Sent message:', data);

        const labelName = 'Vacation Reply';
        await addLabelToEmail(data.id, labelName, accessToken);

        // await markThreadAsRead(threadIdSending, accessToken);

    } catch (error) {
        console.error('Error sending reply:', error.message);
        console.error('Error response:', error.response.data);
    }
}


// const threadId = sentMessage.threadId;

// Add label to the sent reply email
// const labelName = 'Vacation Reply';
// await addLabelToEmail(sentMessage.id, labelName, accessToken);

// await markThreadAsRead(threadId, accessToken);

// async function markThreadAsRead(threadId, accessToken) {
//     try {
//         await axios.post(
//             `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
//             {
//                 removeLabelIds: ['UNREAD']
//             },
//             {
//                 headers: {
//                     Authorization: `Bearer ${accessToken}`,
//                     'Content-Type': 'application/json'
//                 }
//             }
//         );
//     } catch (error) {
//         console.error('Error marking thread as read:', error.message);
//     }
// }

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
    return new Promise((resolve) => setTimeout(resolve, ms));
}

runAutoReply().catch(console.error);
