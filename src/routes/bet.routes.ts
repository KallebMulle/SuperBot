import { Router, Request, Response } from 'express';
import { prisma } from '../index';

const router = Router();

// Get all bets
router.get('/', async (req: Request, res: Response) => {
  try {
    const bets = await prisma.bet.findMany({
      where: { userId: req.userId },
      include: { alert: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

// Get user statistics
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    const bets = await prisma.bet.findMany({
      where: { userId: req.userId, result: { not: null } },
    });

    const wonBets = bets.filter((b) => b.result === 'won').length;
    const totalProfit = bets.reduce((acc, b) => acc + (b.profit || 0), 0);

    res.json({
      balance: user?.balance,
      roi: user?.roi,
      wins: user?.wins,
      losses: user?.losses,
      wonBets,
      totalBets: bets.length,
      totalProfit,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Create bet
router.post('/', async (req: Request, res: Response) => {
  try {
    const { amount, odds, alertId } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const bet = await prisma.bet.create({
      data: {
        amount,
        odds,
        alertId,
        userId: req.userId!,
      },
    });

    // Deduct from balance
    await prisma.user.update({
      where: { id: req.userId },
      data: { balance: user.balance - amount },
    });

    res.status(201).json(bet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create bet' });
  }
});

// Update bet result
router.patch('/:id/result', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { result } = req.body;

    const bet = await prisma.bet.findUnique({ where: { id } });
    if (!bet) {
      return res.status(404).json({ error: 'Bet not found' });
    }

    let profit = 0;
    if (result === 'won') {
      profit = bet.amount * bet.odds - bet.amount;
    } else {
      profit = -bet.amount;
    }

    const updatedBet = await prisma.bet.update({
      where: { id },
      data: {
        result,
        profit,
        closedAt: new Date(),
      },
    });

    // Update user balance
    const user = await prisma.user.findUnique({ where: { id: bet.userId } });
    if (user) {
      const newBalance = user.balance + profit;
      const newWins = result === 'won' ? user.wins + 1 : user.wins;
      const newLosses = result === 'lost' ? user.losses + 1 : user.losses;
      const roi = ((newBalance - user.balance) / user.balance) * 100;

      await prisma.user.update({
        where: { id: bet.userId },
        data: {
          balance: newBalance,
          wins: newWins,
          losses: newLosses,
          roi,
        },
      });
    }

    res.json(updatedBet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update bet' });
  }
});

// Delete bet
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bet = await prisma.bet.findUnique({ where: { id } });
    if (!bet) {
      return res.status(404).json({ error: 'Bet not found' });
    }

    // Refund balance
    const user = await prisma.user.findUnique({ where: { id: bet.userId } });
    if (user) {
      await prisma.user.update({
        where: { id: bet.userId },
        data: { balance: user.balance + bet.amount },
      });
    }

    await prisma.bet.delete({ where: { id } });

    res.json({ message: 'Bet deleted and balance refunded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete bet' });
  }
});

export default router;