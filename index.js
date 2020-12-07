const core = require('@actions/core');
const aws = require('aws-sdk');
const assert = require('assert');

async function run() {
    try {
        // Get inputs
        const sourceStackName = core.getInput('source-stack-name', { required: true });
        const targetStackName = core.getInput('target-stack-name', { required: true });
        const parameterOverridesString = core.getInput('parameter-overrides', { required: false }) || '{}';

        const parameterOverrides = JSON.parse(parameterOverridesString);

        const cloudformation = new aws.CloudFormation();
        
        // Load our source stack
        const sourceStacks=await cloudformation.describeStacks({ StackName: sourceStackName }).promise();
        if(sourceStacks.Stacks.length == 0) {
            throw new Error(`Failed to load source stack ${sourceStackName}`);
        }

        const sourceStack=sourceStacks.Stacks[0];
        if(sourceStack.StackStatus != "CREATE_COMPLETE") {
            throw new Error(`Source stack ${sourceStackName} has unacceptable status ${sourceStack.StackStatus}`);
        }

        // Load our target stack
        const targetStacks=await cloudFormation.describeStacks({ StackName: targetStackName }).promise();
        if(targetStacks.Stacks.length == 0) {
            throw new Error(`Failed to load target stack ${targetStackName}`);
        }

        const targetStack=targetStacks.Stacks.length != 0
            ? targetStacks.Stacks[0]
            : null;
        if(targetStack && targetStack.StackStatus!="CREATE_COMPLETE") {
            throw new Error(`Target stack ${targetStackName} has unacceptable status ${targetStack.StackStatus}`);
        }

        // Get our source template
        const sourceTemplate=await cloudformation.getTemplate({ StackName: sourceStackName, TemplateStage: "Original" }).promise();
        const sourceTemplateBody=sourceTemplate.TemplateBody;

        // Resolve our parameters
        const parameters = {};
        sourceStack.Parameters.forEach(function(p) {
            parameters[p.ParameterKey] = p.ParameterValue;
        });
        parameterOverrides.entries().forEach(function(p) {
            parameters[p[0]] = p[1];
        });

        // Update our target stack
        if(targetStack) {
            // Our target stack already exists
            await cloudformation.updateStack({
                    StackName: targetStackName,
                    Capabilities: [ 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND' ],
                    Parameters: parameters.entries().map(p => ({ ParameterKey: p[0], ParameterValue: p[1] })),
                    RoleARN: roleArn,
                    TemplateBody: sourceTemplateBody,
                    UsePreviousTemplate: false
                }).promise()
        }
        else {
            // Our target stack does not exist
            await cloudformation.createStack({
                    StackName: targetStackName,
                    OnFailure: 'DELETE',
                    Capabilities: [ 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND' ],
                    Parameters: parameters.entries().map(p => ({ ParameterKey: p[0], ParameterValue: p[1] })),
                    RoleARN: roleArn,
                    TemplateBody: sourceTemplateBody,
                    UsePreviousTemplate: false
                }).promise()
        }

        // Await our status
        const TERMINAL_STATES=[
            "CREATE_COMPLETE", "CREATE_FAILED",
            "ROLLBACK_FAILED", "ROLLBACK_COMPLETE",
            "DELETE_FAILED", "DELETE_COMPLETE",
            "UPDATE_COMPLETE", "UPDATE_ROLLBACK_FAILED", "UPDATE_ROLLBACK_COMPLETE",
            "IMPORT_COMPLETE", "IMPORT_ROLLBACK_FAILED", "IMPORT_ROLLBACK_COMPLETE" ];
        var stacks=await cloudFormation.describeStacks({ StackName: targetStackName }).promise();
        while(stacks.Stacks.length==1 && !TERMINAL_STATES.includes(stack.Stacks[0].StackStatus)) {
            await new Promise(r => setTimeout(r, 15000));
            stacks = await cloudFormation.describeStacks({ StackName: targetStackName }).promise();
        }

        if(stacks.Stacks.length == 0) {
            throw new Error("Target stack failed to create and was deleted");
        }
        if(stacks.Stacks[0].StackStatus.includes("_FAILED")) {
            throw new Error("Target stack failed in state "+stacks.Stacks[0].StackStatus);
        }

        console.log("Success!");
    }
    catch (error) {
        core.setFailed(error.message);

        const showStackTrace = process.env.SHOW_STACK_TRACE;

        if (showStackTrace === 'true') {
            throw(error)
	}
    }
}

module.exports = run;

if (require.main === module) {
    run();
}
