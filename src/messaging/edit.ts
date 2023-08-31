import meta = require('../meta');
import user = require('../user');
import plugins = require('../plugins');
import privileges = require('../privileges');
import sockets = require('../socket.io');

type MessagingType = {
    editMessage: (uid: string, mid: string, roomId: string, content: string) => Promise<void>;
    checkContent: (content: string) => Promise<void>;
    getMessageField: (mid: string, s: string) => Promise<string>;
    setMessageFields: (mid: string, payload: {content: string}) => Promise<void>;
    getUidsInRoom: (roomId: string, a: number, b: number) => Promise<string[]>;
    getMessagesData: (mids: string[], uid: string, roomId: string, b: boolean) => Promise<string[]>;
    messageExists: (messageId: string) => Promise<boolean>;
    getMessageFields: (messageId: string, fields: string[]) =>
        Promise<{system: boolean, fromuid: number, timestamp: number}>;
    canEdit: (messageId: string, uid: string) => Promise<void>;
    canDelete: (messageId: string, uid: string) => Promise<void>;
};

module.exports = function (Messaging: MessagingType) {
    Messaging.editMessage = async (uid, mid, roomId, content) => {
        await Messaging.checkContent(content);
        const raw = await Messaging.getMessageField(mid, 'content');
        if (raw === content) {
            return;
        }

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload: {content: string} = await plugins.hooks.fire('filter:messaging.edit', {
            content: content,
            edited: Date.now(),
        });

        if (!String(payload.content).trim()) {
            throw new Error('[[error:invalid-chat-message]]');
        }
        await Messaging.setMessageFields(mid, payload);

        // Propagate this change to users in the room
        const [uids, messages] = await Promise.all([
            Messaging.getUidsInRoom(roomId, 0, -1),
            Messaging.getMessagesData([mid], uid, roomId, true),
        ]);

        uids.forEach((uid) => {
            // The next line calls a function in a module that has not been updated to TS yet
            /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call,
               @typescript-eslint/no-unsafe-member-access */
            sockets.in(`uid_${uid}`).emit('event:chats.edit', {
                messages: messages,
            });
        });
    };

    const canEditDelete = async (messageId: string, uid: string, type: string) => {
        let durationConfig = '';
        if (type === 'edit') {
            durationConfig = 'chatEditDuration';
        } else if (type === 'delete') {
            durationConfig = 'chatDeleteDuration';
        }

        const exists = await Messaging.messageExists(messageId);
        if (!exists) {
            throw new Error('[[error:invalid-mid]]');
        }

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const isAdminOrGlobalMod = await user.isAdminOrGlobalMod(uid);

        // The next line accesses a member in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (meta.config.disableChat) {
            throw new Error('[[error:chat-disabled]]');
        } else if (!isAdminOrGlobalMod &&
            // The next line accesses a member in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            meta.config.disableChatMessageEditing) {
            throw new Error('[[error:chat-message-editing-disabled]]');
        }

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const userData: {banned: boolean} = await user.getUserFields(uid, ['banned']);
        if (userData.banned) {
            throw new Error('[[error:user-banned]]');
        }

        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const canChat: boolean = await privileges.global.can('chat', uid);
        if (!canChat) {
            throw new Error('[[error:no-privileges]]');
        }

        const messageData = await Messaging.getMessageFields(messageId, ['fromuid', 'timestamp', 'system']);
        if (isAdminOrGlobalMod && !messageData.system) {
            return;
        }

        // The next line accesses a member in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const chatConfigDuration: number = meta.config[durationConfig];
        if (chatConfigDuration && Date.now() - messageData.timestamp > chatConfigDuration * 1000) {
            // The next line accesses a member in a module that has not been updated to TS yet
            /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
               @typescript-eslint/restrict-template-expressions */
            throw new Error(`[[error:chat-${type}-duration-expired, ${meta.config[durationConfig]}]]`);
        }

        if (messageData.fromuid === parseInt(uid, 10) && !messageData.system) {
            return;
        }

        throw new Error(`[[error:cant-${type}-chat-message]]`);
    };

    Messaging.canEdit = async (messageId, uid) => await canEditDelete(messageId, uid, 'edit');
    Messaging.canDelete = async (messageId, uid) => await canEditDelete(messageId, uid, 'delete');
};
