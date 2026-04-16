import nodemailer from 'nodemailer';

export class EmailService {
    private static readonly DEFAULT_RECIPIENT = '469704940@qq.com';

    static async sendReport(content: string) {
        if (!process.env.SMTP_PASS) return;

        const transporter = nodemailer.createTransport({
            host: 'smtp.qq.com',
            port: 465,
            secure: true,
            auth: {
                user: '469704940@qq.com', // 你的QQ
                pass: process.env.SMTP_PASS, // 授权码
            },
        });

        try {
            await transporter.sendMail({
                from: `"商机猎手" <469704940@qq.com>`,
                to: this.DEFAULT_RECIPIENT,
                subject: `🚀 发现金矿！今日商机研报 - ${new Date().toLocaleString()}`,
                text: content,
            });
            console.log('✅ 研报已通过邮件发送至 469704940@qq.com');
        } catch (error) {
            console.error('❌ 邮件发送失败:', error);
        }
    }
}
