import aws  from 'aws-sdk';
//https://adelachao.medium.com/aws-sending-cloudwatch-custom-logs-from-lambda-node-js-e0379ea7a34c

exports.logger = async (message) => {
    const cloudwatchlogs = new aws.CloudWatchLogs();

    // describeLogStreams to get sequenceToken
    const describeParams = {
        limit: 1,
        logGroupName: "fact-checker",
        logStreamNamePrefix: "test"
    }

    const res = await cloudwatchlogs.describeLogStreams(describeParams).promise();
    const logStreams = res.logStreams;
    const sequenceToken = logStreams[0].uploadSequenceToken;

    // putLogEvents 
    const putLogParams = {
    logEvents: [{
        message: JSON.stringify(message),
        timestamp: new Date().getTime()
        }],
        logGroupName: "fact-checker",
        logStreamName: "fact-checker",
        sequenceToken
    };

    return await cloudwatchlogs.putLogEvents(putLogParams).promise();
};